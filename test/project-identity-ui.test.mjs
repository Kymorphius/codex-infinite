import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyncController } from '../public/features/project-sync/index.js';
import { projectKey } from '../public/features/project-sync/model.js';

const id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const a = { deviceId: 'air', path: '/source' }, b = { deviceId: 'win', path: '/target' };
const snapshot = project => ({ ...project, branch: 'main', head: 'a'.repeat(40), clean: true, identitySupported: true, sharedProjectId: null });
const response = data => ({ ok: true, json: async () => data });
function setup(t, { fail = false } = {}) {
  let linked = false, gate;
  const calls = [];
  const catalog = () => ({ schemaVersion: 1, devices: [a, b].map(project => ({ device: { id: project.deviceId, name: project.deviceId }, status: 'connected',
    projects: [{ path: project.path, name: 'App', identitySupported: true, sharedProjectId: linked ? id : null }] })) });
  const controller = createSyncController({ fetchImpl: async (url, options) => {
    calls.push({ url, body: options.body && JSON.parse(options.body) });
    if (url.endsWith('/catalog')) return response(catalog());
    if (url.endsWith('/preflight')) return response({ token: 'one-time-link-token', source: snapshot(a), target: snapshot(b), unchanged: true, expiresAt: new Date(Date.now() + 60000).toISOString() });
    if (url.endsWith('/link')) {
      if (gate) await gate;
      if (fail) throw Error('connection lost');
      linked = true; return response({ linked: true, projectId: id });
    }
    if (url.endsWith('/unlink')) { linked = false; return response({ unlinked: true, project: b }); }
    throw Error('unexpected route');
  } });
  t.after(() => controller.dispose());
  return { controller, calls, setGate: value => { gate = value; } };
}
async function select(f) {
  await f.controller.refresh(); f.controller.select('source', projectKey(a)); f.controller.select('target', projectKey(b));
  await f.controller.preflight();
}

test('identity can link identical versions and refresh persists hints without silently selecting another target', async t => {
  const f = setup(t); await select(f);
  assert.equal(f.controller.getState().canExecute, false); assert.equal(f.controller.getState().canLink, true);
  assert.equal(await f.controller.link(), true);
  assert.equal(f.controller.getState().source.sharedProjectId, id);
  assert.equal(f.controller.getState().target.sharedProjectId, id);
  assert.equal(f.controller.getState().targetKey, projectKey(b));
  assert.equal(f.controller.getState().preflight, null);
  assert.equal(f.controller.getState().canLink, false);
  assert.match(f.controller.getState().notice, /代码尚未更新/);
  assert.deepEqual(f.calls.find(call => call.url.endsWith('/link')).body, { token: 'one-time-link-token' });
  assert.equal(await f.controller.link(), false);
  assert.equal(await f.controller.unlink('target'), true);
  assert.deepEqual(f.calls.find(call => call.url.endsWith('/unlink')).body, { project: b, projectId: id });
  assert.match(f.controller.getState().notice, /项目文件.*均保留/);
});

test('mapping writes lock selection and unknown results invalidate the permit without retry', async t => {
  const f = setup(t, { fail: true }); await select(f);
  let release; f.setGate(new Promise(resolve => { release = resolve; }));
  const pending = f.controller.link();
  assert.equal(f.controller.select('source', ''), false);
  release(); assert.equal(await pending, false);
  assert.equal(f.calls.filter(call => call.url.endsWith('/link')).length, 1);
  assert.equal(f.controller.getState().stale, true);
  assert.equal(f.controller.getState().preflight, null);
  assert.match(f.controller.getState().error, /刷新设备.*不会自动重试/);
  assert.equal(await f.controller.link(), false);
  assert.equal(await f.controller.refresh(), true);
});
