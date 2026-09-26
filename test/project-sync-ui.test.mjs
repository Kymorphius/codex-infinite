import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyncController } from '../public/features/project-sync/index.js';
import { projectKey } from '../public/features/project-sync/model.js';

const head = 'b'.repeat(40), previous = 'a'.repeat(40);
const source = { deviceId: 'desk', path: '/work/app' }, target = { deviceId: 'laptop', path: '/home/app' };
const catalog = () => ({ status: 'ok', schemaVersion: 1, devices: [
  { device: { id: 'desk', name: '工作机', kind: 'local-codex' }, status: 'connected', projects: [{ name: 'App', path: source.path }] },
  { device: { id: 'laptop', name: '笔记本', kind: 'remote-codex' }, status: 'connected', projects: [{ name: 'App', path: target.path }] }
] });
const preview = (overrides = {}) => ({ status: 'ok', token: 'one-use-token', source: { ...source, branch: 'main', head, clean: true },
  target: { ...target, branch: 'main', head: previous, clean: true }, unchanged: false, expiresAt: new Date(Date.now() + 60000).toISOString(), ...overrides });
const verified = (overrides = {}) => ({ status: 'ok', verified: true, unchanged: false,
  target: { ...target, branch: 'main', head, clean: true }, ...overrides });
const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
async function setup(t, fetchImpl, options = {}) {
  const controller = createSyncController({ fetchImpl: fetchImpl || (path => response(path.endsWith('/catalog') ? catalog() : path.endsWith('/preflight') ? preview() : verified())), ...options });
  t.after(() => controller.dispose()); await controller.refresh();
  controller.select('source', projectKey(source)); controller.select('target', projectKey(target)); return controller;
}

test('preflight and one-time execution bind the selected direction and verified target', async t => {
  const calls = [], controller = await setup(t, (path, options) => {
    calls.push({ path, body: options.body && JSON.parse(options.body) });
    return response(path.endsWith('/catalog') ? catalog() : path.endsWith('/preflight') ? preview() : verified());
  });
  assert.equal(controller.getState().canPreflight, true);
  assert.equal(await controller.preflight(), true);
  assert.deepEqual(calls[1].body, { source, target });
  assert.equal(controller.getState().canExecute, true);
  assert.equal('token' in controller.getState().preflight, false);
  assert.equal(await controller.execute(), true);
  assert.deepEqual(calls[2].body, { token: 'one-use-token' });
  assert.equal(controller.getState().result.target.head, head);
  assert.match(controller.getState().notice, /读回确认/);
  assert.equal(await controller.execute(), false);
  assert.equal(calls.filter(call => call.path.endsWith('/execute')).length, 1);
});

test('selection change immediately invalidates a successful preflight', async t => {
  const controller = await setup(t); await controller.preflight();
  controller.select('target', '');
  assert.equal(controller.getState().preflight, null);
  assert.equal(controller.getState().canExecute, false);
  assert.match(controller.getState().notice, /选择已变化/);
  assert.equal(await controller.execute(), false);
});

test('an old preflight response cannot restore approval after the selection changed', async t => {
  const pending = deferred(), controller = await setup(t, path => path.endsWith('/preflight') ? pending.promise : response(catalog()));
  const preflight = controller.preflight(); controller.select('target', '');
  pending.resolve(response(preview())); assert.equal(await preflight, false);
  assert.equal(controller.getState().target, undefined);
  assert.equal(controller.getState().preflight, null);
  assert.equal(controller.getState().busy, null);
});

test('an older preflight cannot overwrite a newer preflight', async t => {
  const pending = deferred(); let checks = 0;
  const controller = await setup(t, path => {
    if (path.endsWith('/preflight')) return ++checks === 1 ? pending.promise : response(preview({ token: 'new-token' }));
    return response(catalog());
  });
  const old = controller.preflight();
  await Promise.resolve(); controller.select('target', ''); controller.select('target', projectKey(target));
  await controller.preflight(); pending.resolve(response(preview({ source: { ...preview().source, head: 'c'.repeat(40) } })));
  assert.equal(await old, false);
  assert.equal(controller.getState().preflight.source.head, head);
  assert.equal(controller.getState().canExecute, true);
});

test('refresh invalidates a prior approval even when the project list is identical', async t => {
  const controller = await setup(t); await controller.preflight(); await controller.refresh();
  assert.equal(controller.getState().preflight, null);
  assert.equal(controller.getState().canExecute, false);
  assert.equal(controller.getState().sourceKey, projectKey(source));
});

test('same-device projects and offline devices cannot be preflighted', async t => {
  let writes = 0;
  const data = catalog(); data.devices[1].status = 'offline'; data.devices[1].message = '节点尚未升级';
  const controller = await setup(t, path => { if (!path.endsWith('/catalog')) writes++; return response(data); });
  assert.equal(await controller.preflight(), false);
  assert.match(controller.getState().error, /设备暂不可用/);
  controller.select('target', projectKey(source));
  assert.equal(await controller.preflight(), false);
  assert.match(controller.getState().error, /不同设备/);
  assert.equal(writes, 0);
});

test('identical heads show no-op status and never send execute', async t => {
  let writes = 0;
  const controller = await setup(t, path => {
    if (path.endsWith('/execute')) writes++;
    return response(path.endsWith('/catalog') ? catalog() : preview({ unchanged: true, target: { ...preview().target, head } }));
  });
  await controller.preflight();
  assert.equal(controller.getState().preflight.unchanged, true);
  assert.equal(controller.getState().canExecute, false);
  assert.equal(await controller.execute(), false); assert.equal(writes, 0);
});

test('expired or malformed previews never enable execution', async t => {
  for (const data of [preview({ expiresAt: 'invalid' }), preview({ expiresAt: new Date(0).toISOString() }),
    preview({ target: { ...preview().target, path: '/wrong' } }), preview({ source: { ...preview().source, clean: false } }), preview({ unchanged: true })]) {
    const controller = await setup(t, path => response(path.endsWith('/catalog') ? catalog() : data));
    assert.equal(await controller.preflight(), false);
    assert.equal(controller.getState().canExecute, false);
    assert.ok(controller.getState().error);
  }
});

test('execution checks expiry again before consuming approval', async t => {
  let clock = Date.now(), writes = 0;
  const controller = await setup(t, path => {
    if (path.endsWith('/execute')) writes++;
    return response(path.endsWith('/catalog') ? catalog() : preview({ expiresAt: new Date(clock + 1000).toISOString() }));
  }, { now: () => clock });
  await controller.preflight(); clock += 2000;
  assert.equal(await controller.execute(), false); assert.equal(writes, 0);
  assert.equal(controller.getState().preflight, null);
});

test('preflight timeout aborts transport and late responses cannot enable execute', async t => {
  const pending = deferred(); let signal;
  const controller = await setup(t, (path, options) => {
    if (path.endsWith('/preflight')) { signal = options.signal; return pending.promise; }
    return response(catalog());
  }, { requestTimeoutMs: 5 });
  assert.equal(await controller.preflight(), false);
  assert.equal(signal.aborted, true); assert.equal(controller.getState().busy, null);
  assert.match(controller.getState().error, /请求超时/);
  pending.resolve(response(preview())); await Promise.resolve();
  assert.equal(controller.getState().canExecute, false);
});

test('uncertain execute timeout consumes approval, never retries, and keeps error visible', async t => {
  let writes = 0, reads = 0;
  const controller = await setup(t, path => {
    if (path.endsWith('/execute')) { writes++; return new Promise(() => {}); }
    if (path.endsWith('/catalog')) { reads++; return response(catalog()); }
    return response(preview());
  }, { requestTimeoutMs: 5 });
  await controller.preflight(); assert.equal(await controller.execute(), false);
  assert.equal(writes, 1); assert.equal(reads, 1);
  assert.equal(controller.getState().busy, null); assert.equal(controller.getState().preflight, null);
  assert.equal(controller.getState().result, null);
  assert.match(controller.getState().error, /结果尚未确认.*不会自动重试/);
  controller.select('target', ''); assert.match(controller.getState().error, /结果尚未确认/);
});

test('a complete matching readback is required, not merely HTTP success', async t => {
  for (const body of [{ status: 'ok' }, verified({ verified: false }), verified({ target: { ...verified().target, head: previous } }),
    verified({ target: { ...verified().target, branch: 'other' } }), verified({ target: { ...verified().target, clean: false } }),
    verified({ target: { ...verified().target, deviceId: 'other' } })]) {
    const controller = await setup(t, path => response(path.endsWith('/catalog') ? catalog() : path.endsWith('/preflight') ? preview() : body));
    await controller.preflight(); assert.equal(await controller.execute(), false);
    assert.equal(controller.getState().result, null); assert.equal(controller.getState().canExecute, false);
    assert.match(controller.getState().error, /尚未确认/);
  }
});

test('busy execution prevents selection, refresh and duplicate mutation', async t => {
  const pending = deferred(); let writes = 0;
  const controller = await setup(t, path => {
    if (path.endsWith('/execute')) { writes++; return pending.promise; }
    return response(path.endsWith('/catalog') ? catalog() : preview());
  });
  await controller.preflight(); const executing = controller.execute();
  assert.equal(controller.select('target', ''), false);
  assert.equal(await controller.refresh(), false); assert.equal(await controller.execute(), false);
  assert.equal(controller.getState().targetKey, projectKey(target));
  pending.resolve(response(verified())); await executing; assert.equal(writes, 1);
});

test('catalog failure retains context but prevents using stale project choices', async t => {
  let reads = 0;
  const controller = await setup(t, () => response(++reads === 1 ? catalog() : { schemaVersion: 1, devices: [{}] }));
  assert.equal(await controller.refresh(), false);
  assert.equal(controller.getState().projects.length, 2);
  assert.equal(controller.getState().stale, true); assert.equal(controller.getState().canPreflight, false);
  assert.match(controller.getState().error, /格式无效/);
});

test('HTTP conflict remains visible and never automatically replays execution', async t => {
  let writes = 0;
  const controller = await setup(t, path => {
    if (path.endsWith('/execute')) { writes++; return response({ message: '源项目版本已变化' }, 409); }
    return response(path.endsWith('/catalog') ? catalog() : preview());
  });
  await controller.preflight(); await controller.execute();
  assert.equal(writes, 1); assert.match(controller.getState().error, /源项目版本已变化.*重新预检/);
  assert.equal(controller.getState().canExecute, false);
});
