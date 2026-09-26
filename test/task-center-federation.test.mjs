import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskCenterFederation } from '../src/task-center-federation.mjs';
import { GENERAL_TASK_SCOPE_ID } from '../src/task-center-contract.mjs';

const scopeId = GENERAL_TASK_SCOPE_ID, revision = 'a'.repeat(64), thread = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const item = (ownerDeviceId, extra = {}) => ({ source: 'checklist', ownerDeviceId, scopeId, id: 'same-id', text: 'same task title', revision, ...extra });
const snapshot = (id, items = [item(id)]) => ({ version: 1, device: { id }, updatedAt: '2026-09-26T00:00:00Z', items });
const action = (ownerDeviceId, extra = {}) => ({ ownerDeviceId, scopeId, id: 'same-id', requestId: 'request-one', expectedRevision: revision, type: 'edit', text: 'edited', ...extra });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function fixture({ remoteRead = async () => snapshot('win'), remoteApply, localRead = async () => snapshot('mac'), localApply } = {}) {
  const calls = { localRead: 0, remoteRead: 0, localApply: [], remoteApply: [], images: [] };
  let clock = 1000;
  const localOwner = { read: async () => { calls.localRead++; return localRead(); }, apply: async input => { calls.localApply.push(input); return localApply ? localApply(input) : { applied: true, requestId: input.requestId, item: item('mac', { text: input.text || 'same task title' }) }; } };
  const remote = { read: async () => { calls.remoteRead++; return remoteRead(); }, apply: async input => { calls.remoteApply.push(input); return remoteApply ? remoteApply(input) : { applied: true, requestId: input.requestId, item: item('win', { text: input.text || 'same task title' }) }; }, images: async input => { calls.images.push(input); return { version: 1, images: [] }; } };
  const service = new TaskCenterFederation({ localOwner, localDevice: { id: 'mac', name: 'Mac' }, peers: [{ peer: { id: 'win', name: 'Windows' }, taskCenter: remote }], clock: () => clock, cacheMs: 10 });
  return { service, calls, setClock: value => { clock = value; } };
}

test('first paint waits only for local snapshot and merges deferred devices without colliding IDs', async () => {
  const remote = deferred(), { service, calls } = fixture({ remoteRead: () => remote.promise });
  const first = await service.read();
  assert.equal(first.devices[0].status, 'connected'); assert.equal(first.devices[1].status, 'loading');
  remote.resolve(snapshot('win'));
  const full = await service.read({ wait: true });
  assert.equal(full.devices[1].status, 'connected');
  const [localItem, remoteItem] = full.devices.map(group => group.items[0]);
  assert.equal(localItem.id, remoteItem.id); assert.notEqual(localItem.key, remoteItem.key);
  await service.read({ wait: true });
  assert.deepEqual([calls.localRead, calls.remoteRead], [1, 1]);
});

test('concurrent reads coalesce and offline refresh retains the last successful owner snapshot with backoff', async () => {
  let offline = false;
  const { service, calls, setClock } = fixture({ remoteRead: async () => { if (offline) throw Error('ssh unavailable'); return snapshot('win'); } });
  await Promise.all([service.read({ wait: true }), service.read({ wait: true }), service.read({ wait: true })]);
  assert.equal(calls.remoteRead, 1);
  offline = true; setClock(1011);
  const failed = await service.read({ wait: true });
  assert.equal(failed.devices[1].status, 'offline'); assert.equal(failed.devices[1].items[0].ownerDeviceId, 'win');
  assert.equal(failed.devices[1].updatedAt, '2026-09-26T00:00:00Z');
  setClock(1012); await service.read({ wait: true }); assert.equal(calls.remoteRead, 2);
  offline = false; await service.read({ force: true, wait: true }); assert.equal(calls.remoteRead, 3);
  assert.equal((await service.read()).devices[1].status, 'connected');
});

test('invalid source identity, forged owners, duplicate items and unsupported versions never enter the directory', async () => {
  for (const payload of [snapshot('wrong-device'), snapshot('win', [item('mac')]), snapshot('win', [item('win'), item('win')]), { ...snapshot('win'), version: 0 }]) {
    const { service } = fixture({ remoteRead: async () => payload });
    const result = await service.read({ wait: true });
    assert.notEqual(result.devices[1].status, 'connected'); assert.deepEqual(result.devices[1].items, []);
    assert.equal(result.devices[0].items[0].ownerDeviceId, 'mac');
  }
});

test('editing one of identical cross-device IDs writes only its owner and rejects unknown ownership', async () => {
  const { service, calls } = fixture();
  await service.read({ wait: true });
  const result = await service.apply(action('win'));
  assert.equal(result.ownerDeviceId, 'win'); assert.equal(calls.remoteApply.length, 1); assert.equal(calls.localApply.length, 0);
  assert.equal(calls.remoteApply[0].id, 'same-id');
  await assert.rejects(service.apply(action('unknown')), /未知任务所属设备/);
  assert.equal(calls.remoteApply.length, 1);
  await service.apply(action('mac', { type: 'assign', assignedDeviceId: 'win', assignedThreadId: thread }));
  assert.equal(calls.localApply.length, 1); assert.equal(calls.remoteApply.length, 1);
});

test('writes wait for existing owner reads and publish the confirmed item immediately', async () => {
  const oldRead = deferred(); let changed = false;
  const { service, calls } = fixture({ remoteRead: () => changed ? snapshot('win', [item('win', { text: 'after' })]) : oldRead.promise,
    remoteApply: async input => { changed = true; return { applied: true, requestId: input.requestId, item: item('win', { text: 'after' }) }; } });
  await service.read();
  const write = service.apply(action('win'));
  await Promise.resolve(); assert.equal(calls.remoteApply.length, 0);
  oldRead.resolve(snapshot('win', [item('win', { text: 'before' })]));
  await write;
  assert.equal((await service.read()).devices[1].items[0].text, 'after');
});

test('confirmed mutations return without waiting for a second snapshot and stale in-flight reads cannot overwrite them', { timeout: 2000 }, async () => {
  const writeStarted = deferred(), finishWrite = deferred(), staleRead = deferred(); let reads = 0, committed = false;
  const { service, calls } = fixture({
    remoteRead: () => ++reads === 1 ? snapshot('win', [item('win', { text: 'before' })]) : committed && reads > 2 ? snapshot('win', [item('win', { text: 'confirmed' })]) : staleRead.promise,
    remoteApply: async input => { writeStarted.resolve(); await finishWrite.promise; committed = true; return { applied: true, requestId: input.requestId, item: item('win', { text: 'confirmed' }) }; }
  });
  await service.read({ wait: true });
  const writing = service.apply(action('win')); await writeStarted.promise;
  await service.read({ force: true });
  const pendingRead = service.pending.get('win');
  finishWrite.resolve();
  const result = await writing;
  assert.equal(result.item.text, 'confirmed'); assert.equal(calls.remoteRead, 2);
  assert.equal((await service.read()).devices[1].items[0].text, 'confirmed');
  staleRead.resolve(snapshot('win', [item('win', { text: 'obsolete snapshot' })]));
  await pendingRead;
  assert.equal((await service.read()).devices[1].items[0].text, 'confirmed');
});

test('unconfirmed writes are not represented as success and image requests route exact owner references', async () => {
  const { service, calls } = fixture({ remoteApply: async () => ({ applied: true, requestId: 'different' }) });
  await assert.rejects(service.apply(action('win')), /未确认操作结果/);
  assert.deepEqual(await service.imageBundle(item('win')), { version: 1, images: [] });
  assert.deepEqual(calls.images, [{ scopeId, id: 'same-id', expectedRevision: revision }]);
  await assert.rejects(service.imageBundle(item('mac')), /暂不支持图片传输/);
});
