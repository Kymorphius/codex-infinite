import test from 'node:test';
import assert from 'node:assert/strict';
import { actionIssue, assignmentTargets, catalogRows, filterRows, itemStatus, sessionKey, statusLabel, taskDestination } from '../public/features/task-center/model.js';
import { createTaskCenterController } from '../public/features/task-center/controller.js';

const thread = '01a0ac42-2552-7141-8ec9-12c50515ac4a';
const item = (device, id, extra = {}) => ({ key: `${device}:scope:${id}`, ownerDeviceId: device, scopeId: 'scope', id, source: 'checklist',
  text: `任务 ${device} ${id}`, revision: 'revision-1', createdAt: '2026-09-26T01:00:00Z', ...extra });
const catalog = (extra = {}) => ({ version: 1, localDeviceId: 'mac', devices: [
  { device: { id: 'mac', name: 'Mac' }, status: 'connected', items: [item('mac', 'one')] },
  { device: { id: 'win', name: 'Windows' }, status: 'connected', items: [item('win', 'one')] }
], ...extra });
const tasks = () => ['mac', 'win'].map(id => ({ id: thread, title: '同名会话', device: { id, status: 'connected' } }));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
async function setup(request, extra = {}) {
  const calls = []; let count = 0;
  const controller = createTaskCenterController({ request: async (path, options) => {
    calls.push({ path, ...options }); return request ? request(path, options) : path.endsWith('/actions') ? { status: 'ok', applied: true, requestId: options.body.requestId } : catalog();
  }, tasks, randomUUID: () => `uuid-${++count}`, ...extra });
  await controller.load(); return { controller, calls };
}

test('all-device list retains identical source IDs separately and does not duplicate local dispatch management', () => {
  const data = catalog();
  data.devices[0].items.push(item('mac', 'dispatch', { source: 'dispatch' }));
  data.devices[1].items.push(item('win', 'dispatch', { source: 'dispatch', status: 'queued' }));
  const rows = catalogRows(data);
  assert.equal(rows.length, 3); assert.equal(new Set(rows.map(row => row.key)).size, 3);
  assert.equal(rows.some(row => row.ownerDeviceId === 'mac' && row.source === 'dispatch'), false);
  assert.equal(statusLabel(rows.find(row => row.source === 'dispatch')), '排队中');
});

test('oldest added order survives updates and filters compose by owner, content and status', () => {
  const data = catalog();
  data.devices[1].items[0].createdAt = '2026-09-25T01:00:00Z';
  data.devices[1].items[0].updatedAt = '2026-09-28T01:00:00Z';
  const rows = catalogRows(data);
  assert.equal(rows[0].ownerDeviceId, 'win');
  assert.equal(filterRows(rows, { device: 'win', query: 'windows', status: 'inbox' }).length, 1);
  assert.equal(filterRows(rows, { device: 'mac', query: 'windows' }).length, 0);
});

test('assignment targets require native UUID and connected device; equal session UUIDs remain distinct', () => {
  const data = catalog();
  let targets = assignmentTargets([...tasks(), { id: 'cloud-id', device: { id: 'mac' } }], data);
  assert.equal(targets.length, 2); assert.notEqual(targets[0].key, targets[1].key);
  data.devices[1].status = 'offline'; targets = assignmentTargets(tasks(), data);
  assert.deepEqual(targets.map(target => target.device.id), ['mac']);
});

test('delivered remains a separate task state and cannot be returned or reassigned', () => {
  const delivered = { ...catalogRows(catalog())[0], assignedThreadId: thread, executionState: 'delivered' };
  assert.equal(itemStatus(delivered), 'delivered'); assert.equal(statusLabel(delivered), '已交付');
  assert.match(actionIssue(delivered, 'return'), /已经交付/);
  assert.match(actionIssue(delivered, 'assign'), /已经交付/);
  assert.equal(actionIssue(delivered, 'complete'), '');
  assert.equal(itemStatus({ ...delivered, done: true }), 'done');
});

test('cross-device assignment uses exact owner identity, revision and target; creates no send request', async () => {
  const { controller, calls } = await setup();
  controller.edit('assign', 'mac:scope:one'); controller.draft({ target: sessionKey(tasks()[1]) });
  assert.equal(await controller.submit(), true);
  const writes = calls.filter(call => call.method === 'POST'); assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].body, { type: 'assign', ownerDeviceId: 'mac', scopeId: 'scope', id: 'one', expectedRevision: 'revision-1',
    requestId: 'uuid-1', assignedProvider: 'codex', assignedDeviceId: 'win', assignedThreadId: thread });
  assert.equal(writes[0].path, '/api/task-center/actions');
  assert.match(controller.getState().notice, /Windows.*保持暂停/);
});

test('creation preserves editor content and generates separate item/request identities', async () => {
  const { controller, calls } = await setup();
  controller.edit('create'); controller.draft({ text: '1. 保留编号\n2. 保存待办', ownerDeviceId: 'win' });
  await controller.submit();
  assert.deepEqual(calls.find(call => call.method === 'POST').body, { type: 'create', ownerDeviceId: 'win', id: 'uuid-1', requestId: 'uuid-2', text: '1. 保留编号\n2. 保存待办' });
});

test('refresh keeps drafts and detects a changed owner version before any write', async () => {
  let data = catalog(); const { controller, calls } = await setup(() => data);
  controller.edit('edit', 'mac:scope:one'); controller.draft({ text: '未保存草稿' });
  data = catalog(); data.devices[0].items[0].revision = 'revision-2';
  await controller.load({ explicit: true });
  assert.equal(controller.getState().editor.text, '未保存草稿');
  assert.equal(await controller.submit(), false); assert.equal(calls.some(call => call.method === 'POST'), false);
  assert.match(controller.getState().error, /另一处修改/);
});

test('unknown mutation result disables writes until an explicit refresh and is never automatically retried', async () => {
  let writes = 0;
  const { controller } = await setup((path) => { if (path.endsWith('/actions')) { writes++; throw Error('连接断开'); } return catalog(); });
  controller.edit('edit', 'mac:scope:one'); controller.draft({ text: '草稿' });
  assert.equal(await controller.submit(), false); assert.equal(await controller.submit(), false);
  assert.equal(writes, 1); assert.match(controller.getState().error, /不会自动重复提交/);
  assert.equal(controller.getState().editor.text, '草稿');
  await controller.load(); assert.equal(controller.getState().stale, true);
  await controller.load({ explicit: true }); assert.equal(controller.getState().stale, false);
});

test('in-flight mutations prevent duplicate submit and editor changes', async () => {
  const pending = deferred(); const { controller, calls } = await setup(path => path.endsWith('/actions') ? pending.promise : catalog());
  controller.edit('return', 'mac:scope:one'); const first = controller.submit();
  assert.equal(controller.edit('delete', 'win:scope:one'), false); controller.cancel();
  assert.equal(controller.getState().editor.type, 'return'); assert.equal(await controller.submit(), false);
  pending.resolve({ status: 'ok', applied: true, requestId: 'uuid-1' }); await first;
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
});

test('failed catalog retains the last rows read-only and rejects offline source modifications', async () => {
  let unavailable = false;
  const { controller, calls } = await setup(() => { if (unavailable) throw Error('服务不可用'); return catalog(); });
  unavailable = true; await controller.load({ explicit: true });
  assert.equal(controller.getState().rows.length, 2); assert.equal(controller.edit('delete', 'mac:scope:one'), false);
  assert.equal(calls.some(call => call.method === 'POST'), false);
  const offline = catalogRows({ ...catalog(), devices: [{ ...catalog().devices[0], status: 'offline' }] })[0];
  assert.match(actionIssue(offline, 'edit'), /暂不可用/);
});

test('load coalesces requests, batches 50 rows and resets pagination when filtering', async () => {
  const pending = deferred(); const data = catalog(); data.devices[0].items = Array.from({ length: 104 }, (_, id) => item('mac', String(id)));
  let reads = 0; const controller = createTaskCenterController({ request: () => { reads++; return pending.promise; } });
  const first = controller.load(), second = controller.load(); assert.equal(reads, 1);
  pending.resolve(data); await Promise.all([first, second]);
  assert.equal(controller.getState().visible.length, 50); controller.more(); assert.equal(controller.getState().visible.length, 100);
  controller.filter({ device: 'win' }); assert.equal(controller.getState().visible.length, 1); assert.equal(controller.getState().limit, 50);
});

test('pre-write read response cannot replace a newer owner version', async () => {
  let reads = 0; const oldRead = deferred(); const fresh = catalog(); fresh.devices[0].items[0].revision = 'new';
  const { controller } = await setup(path => path.endsWith('/actions') ? { status: 'ok', applied: true, requestId: 'uuid-1' } : ++reads === 1 ? catalog() : reads === 2 ? oldRead.promise : fresh);
  controller.edit('complete', 'mac:scope:one'); const refresh = controller.load({ explicit: true }); const submitting = controller.submit();
  oldRead.resolve(catalog()); await refresh; await submitting;
  assert.equal(controller.getState().rows.find(row => row.ownerDeviceId === 'mac').revision, 'new');
});

test('HTTP success without the exact applied receipt remains unconfirmed', async () => {
  for (const receipt of [{ status: 'ok' }, { status: 'ok', applied: true, requestId: 'another-request' }]) {
    const { controller } = await setup(path => path.endsWith('/actions') ? receipt : catalog());
    controller.edit('complete', 'mac:scope:one'); assert.equal(await controller.submit(), false);
    assert.equal(controller.getState().stale, true); assert.match(controller.getState().error, /尚未确认/);
  }
});

test('unconfirmed delivery reservations remain review-only for all management operations with no age-based unlock', async () => {
  const data = catalog(), reservation = { token: 'reserved', requestId: 'delivery', assignedDeviceId: 'win', assignedThreadId: thread, createdAt: '1970-01-01T00:00:00Z' };
  data.devices[0].items[0].deliveryReservation = reservation;
  const reserved = catalogRows(data)[0];
  assert.equal(itemStatus(reserved), 'review'); assert.equal(statusLabel(reserved), '待核对');
  assert.equal(itemStatus({ ...reserved, done: true, executionState: 'delivered' }), 'review');
  assert.deepEqual(taskDestination(reserved), { provider: 'codex', deviceId: 'win', threadId: thread });
  assert.equal(filterRows(catalogRows(data), { status: 'assigned' }).length, 0);
  assert.equal(filterRows(catalogRows(data), { status: 'review' }).length, 1);
  const { controller, calls } = await setup(() => data);
  for (const type of ['edit', 'assign', 'return', 'complete', 'reopen', 'delete']) {
    assert.match(actionIssue(reserved, type, true), /待核对.*目标会话是否已收到/);
    assert.equal(controller.edit(type, reserved.key), false);
    assert.match(controller.getState().error, /待核对/);
  }
  await controller.load({ explicit: true }); assert.equal(controller.edit('delete', reserved.key), false);
  assert.equal(calls.some(call => call.method === 'POST'), false);
});

test('reservation arriving during an edit blocks submission and preserves the draft', async () => {
  let data = catalog(); const { controller, calls } = await setup(() => data);
  controller.edit('edit', 'mac:scope:one'); controller.draft({ text: '未提交的修改' });
  data = catalog(); data.devices[0].items[0].deliveryReservation = { token: 'reserved', assignedDeviceId: 'win', assignedThreadId: thread };
  await controller.load({ explicit: true });
  assert.equal(await controller.submit(), false); assert.match(controller.getState().error, /待核对/);
  assert.equal(controller.getState().editor.text, '未提交的修改'); assert.equal(calls.some(call => call.method === 'POST'), false);
});
