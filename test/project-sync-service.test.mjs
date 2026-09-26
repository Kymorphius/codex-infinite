import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectSyncService } from '../src/project-sync-service.mjs';

const oldHead = 'a'.repeat(40), newHead = 'b'.repeat(40), thirdHead = 'c'.repeat(40);
function setup() {
  let time = 1000;
  const source = { path: '/source', branch: 'main', head: newHead, clean: true };
  const target = { path: '/target', branch: 'main', head: oldHead, clean: true };
  let applies = 0;
  const local = {
    catalog: async () => ({ projects: [{ path: source.path, name: 'Source' }] }),
    inspect: async () => ({ ...source }),
    export: async () => ({ head: source.head, branch: source.branch, bundle: 'opaque', sha256: 'private' })
  };
  const remote = {
    peer: { id: 'remote', name: 'Target' },
    catalog: async () => ({ projects: [{ path: target.path, name: 'Target', privateData: 'must not leak' }] }),
    inspect: async () => ({ ...target }),
    prepare: async () => ({ token: 'target-token-123456789', target: { ...target }, source: { ...source }, unchanged: false }),
    apply: async () => { applies++; target.head = source.head; return { verified: true, unchanged: false, target: { ...target } }; }
  };
  const service = new ProjectSyncService({ localAdapter: local, localDevice: { id: 'local', name: 'Source' }, peers: [remote], now: () => time });
  const selection = { source: { deviceId: 'local', path: source.path }, target: { deviceId: 'remote', path: target.path } };
  return { service, local, remote, source, target, selection, applies: () => applies, advance: ms => { time += ms; } };
}

test('preview exposes only versions; execute confirms destination and consumes the token', async () => {
  const f = setup(), preview = await f.service.preflight(f.selection);
  assert.equal(preview.source.head, newHead); assert.equal(preview.target.head, oldHead);
  assert.equal(preview.unchanged, false); assert.ok(!JSON.stringify(preview).includes('opaque'));
  const result = await f.service.execute({ token: preview.token });
  assert.deepEqual(result, { verified: true, unchanged: false, target: { ...f.target, deviceId: 'remote' } });
  await assert.rejects(f.service.execute({ token: preview.token }), /已使用或过期/);
  assert.equal(f.applies(), 1);
});

test('source changed after preview cannot update the destination', async () => {
  const f = setup(), preview = await f.service.preflight(f.selection);
  f.source.head = thirdHead;
  await assert.rejects(f.service.execute({ token: preview.token }), /源项目已变化/);
  assert.equal(f.applies(), 0); assert.equal(f.target.head, oldHead);
});

test('expired token and concurrent duplicate execution never repeat a write', async () => {
  const f = setup(), expired = await f.service.preflight(f.selection);
  f.advance(600001);
  await assert.rejects(f.service.execute({ token: expired.token }), /过期/);
  const valid = await f.service.preflight(f.selection);
  const outcomes = await Promise.allSettled([f.service.execute({ token: valid.token }), f.service.execute({ token: valid.token })]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1); assert.equal(f.applies(), 1);
});

test('identical commits skip package transfer and require fresh destination readback', async () => {
  const f = setup(); f.target.head = f.source.head;
  f.local.export = f.remote.prepare = async () => { throw new Error('unnecessary transfer'); };
  const preview = await f.service.preflight(f.selection);
  assert.equal(preview.unchanged, true);
  f.target.head = thirdHead;
  await assert.rejects(f.service.execute({ token: preview.token }), /未确认同步结果/);
  assert.equal(f.applies(), 0);
});

test('branch, same device and unknown device selections fail before any transfer', async () => {
  const f = setup(); f.local.export = async () => { throw new Error('unexpected export'); };
  await assert.rejects(f.service.preflight({ ...f.selection, target: { deviceId: 'local', path: '/other' } }), /不同设备/);
  await assert.rejects(f.service.preflight({ ...f.selection, target: { deviceId: 'unknown', path: '/other' } }), /未配置/);
  f.target.branch = 'feature';
  await assert.rejects(f.service.preflight(f.selection), /分支不同/);
});

test('offline catalogs remain visible and returned projects discard adapter private fields', async () => {
  const f = setup(); f.local.catalog = async () => { throw new Error('private remote url'); };
  const result = await f.service.catalog();
  assert.equal(result.devices[0].status, 'offline');
  assert.deepEqual(result.devices[1].projects, [{ path: '/target', name: 'Target' }]);
  assert.ok(!JSON.stringify(result).includes('private'));
});

test('unconfirmed write and transport loss are never automatically retried', async () => {
  for (const response of [{ verified: false }, { verified: true, unchanged: false, target: { path: '/target', branch: 'main', head: oldHead, clean: true } }, null]) {
    const f = setup(); let attempts = 0;
    f.remote.apply = async () => { attempts++; if (response === null) throw new Error('result unknown'); return response; };
    const preview = await f.service.preflight(f.selection);
    await assert.rejects(f.service.execute({ token: preview.token }));
    await assert.rejects(f.service.execute({ token: preview.token }));
    assert.equal(attempts, 1);
  }
});

test('changed source during transfer and mismatched target preparation do not issue a token', async () => {
  const f = setup(), prepare = f.remote.prepare;
  f.remote.prepare = async () => { const result = await prepare(); f.source.head = thirdHead; return result; };
  await assert.rejects(f.service.preflight(f.selection), /预检期间发生变化/);
  assert.equal(f.service.preflights.size, 0);
  f.remote.prepare = async () => ({ ...(await prepare()), target: { ...f.target, head: newHead } });
  await assert.rejects(f.service.preflight(f.selection), /未确认预检结果/);
});

test('in-flight previews reserve capacity before awaiting device reads and release on failure', async () => {
  const f = setup(); f.target.head = f.source.head;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  f.local.inspect = async () => { await gate; return { ...f.source }; };
  const pending = Array.from({ length: 4 }, () => f.service.preflight(f.selection));
  await assert.rejects(f.service.preflight(f.selection), { statusCode: 429 });
  release(); await Promise.all(pending);
  assert.equal(f.service.preflights.size, 4); assert.equal(f.service.pendingPreflights, 0);
  f.local.inspect = async () => { throw Error('offline'); };
  await assert.rejects(f.service.preflight(f.selection), /offline/);
  assert.equal(f.service.pendingPreflights, 0);
  f.local.inspect = async () => ({ ...f.source });
  await f.service.preflight(f.selection);
  assert.equal(f.service.preflights.size, 5);
});
