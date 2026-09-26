import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { TaskCenterChecklistProjection } from '../src/task-center-checklist-projection.mjs';
import { assignedChecklistTasksForThread } from '../src/project-checklist-assignment.mjs';

const GENERAL = 'ccc:general-inbox:v1', thread = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const scope = key => createHash('sha256').update(key).digest('hex');
const item = (ownerDeviceId, extra = {}) => ({ ownerDeviceId, scopeId: scope(GENERAL), id: 'same-id', source: 'checklist', text: '同名任务', done: false, assignedThreadId: null, assignedDeviceId: null, revision: 'a'.repeat(64), ...extra });
function fixture(items, status = 'connected', images) {
  const mutations = [], local = [], snapshot = { devices: [
    { device: { id: 'mac' }, status: 'connected', items: items.filter(value => value.ownerDeviceId === 'mac') },
    { device: { id: 'windows' }, status, items: items.filter(value => value.ownerDeviceId === 'windows') }
  ] };
  const projection = new TaskCenterChecklistProjection({ localDevice: { id: 'mac' }, images,
    store: { directory: '/tasks', file: key => key, apply: async action => { local.push(action); return action.requestId; } },
    service: { read: async () => snapshot, apply: async action => { mutations.push(action); return { applied: true }; } } });
  return { projection, mutations, local, snapshot };
}

test('all source identities remain distinct and only the receiving device gets assigned todos', async () => {
  const h = fixture([
    item('mac'), item('windows'), item('mac', { scopeId: scope('project-a') }),
    item('windows', { id: 'received', assignedDeviceId: 'mac', assignedThreadId: thread }),
    item('windows', { id: 'other-device', assignedDeviceId: 'windows', assignedThreadId: thread }),
    item('mac', { id: 'remote-assignment', assignedDeviceId: 'windows', assignedThreadId: thread }),
    item('windows', { id: 'delivered', assignedDeviceId: 'mac', assignedThreadId: thread, executionState: 'delivered' })
  ]);
  const first = (await h.projection.read(GENERAL)).items, second = (await h.projection.read(GENERAL)).items;
  assert.equal(first.length, 4);
  assert.equal(new Set(first.map(value => value.id)).size, 4);
  assert.equal(first.find(value => value.ownerDeviceId === 'mac' && value.scopeId === scope(GENERAL)).id, 'same-id');
  assert.deepEqual(first.map(value => value.id), second.map(value => value.id));
  const assigned = assignedChecklistTasksForThread(first, thread);
  assert.equal(assigned.length, 1);
  assert.equal(assigned[0].sourceRef.id, 'received');
  assert.equal(assigned[0].sourceRef.ownerDeviceId, 'windows');
  const project = (await h.projection.read('project-a')).items;
  assert.equal(project.length, 1); assert.equal(project[0].id, 'same-id');
});

test('remote deletes route to source identity with CAS and cannot create a local task', async () => {
  const h = fixture([item('windows')]);
  const [task] = (await h.projection.read(GENERAL)).items;
  assert.equal((await h.projection.apply({ ...task, projectKey: GENERAL, type: 'delete', requestId: 'delete-one' })).requestId, 'delete-one');
  assert.deepEqual(h.mutations[0], { ...task.sourceRef, requestId: 'delete-one', expectedRevision: task.expectedRevision, type: 'delete' });
  assert.deepEqual(h.local, []);
  const fresh = fixture([]);
  await assert.rejects(fresh.projection.apply({ id: task.id, projectKey: GENERAL, type: 'upsert', requestId: 'orphan' }), /缺少来源版本/);
  assert.deepEqual(fresh.local, []);
});

test('claim and latest editor content use one versioned assignment while returns preserve the source', async () => {
  const h = fixture([item('windows')]), [task] = (await h.projection.read(GENERAL)).items;
  await h.projection.apply({ ...task, type: 'upsert', assignedThreadId: thread, text: '编辑后领取', requestId: 'claim' });
  assert.deepEqual(h.mutations[0], { ...task.sourceRef, requestId: 'claim', expectedRevision: task.expectedRevision, type: 'assign', text: '编辑后领取', assignedProvider: 'codex', assignedDeviceId: 'mac', assignedThreadId: thread });
  h.snapshot.devices[1].items[0] = { ...item('windows'), assignedThreadId: thread, assignedDeviceId: 'mac' };
  const [assigned] = (await h.projection.read(GENERAL)).items;
  await h.projection.apply({ ...assigned, type: 'upsert', assignedThreadId: null, requestId: 'return' });
  assert.equal(h.mutations[1].type, 'return');
  assert.equal(h.mutations[1].ownerDeviceId, 'windows');
  assert.deepEqual(h.local, []);
});

test('delivery remains independent of completion and read-only source checks carry target identity', async () => {
  const h = fixture([item('windows', { assignedThreadId: thread, assignedDeviceId: 'mac' })]);
  const [task] = (await h.projection.read(GENERAL)).items;
  await h.projection.apply({ ...task, type: 'verify-delivery', requestId: 'preflight' });
  await h.projection.apply({ ...task, type: 'upsert', executionState: 'delivered', done: false, requestId: 'receipt' });
  assert.equal(h.mutations[0].type, 'verify-delivery');
  assert.equal(h.mutations[0].assignedDeviceId, 'mac');
  assert.equal(h.mutations[0].assignedThreadId, thread);
  assert.equal(h.mutations[1].type, 'delivered');
  assert.equal(h.mutations.some(value => value.type === 'complete'), false);
});

test('offline source is visibly read-only and persisted references still route after restart', async () => {
  const h = fixture([item('windows')], 'offline'), [task] = (await h.projection.read(GENERAL)).items;
  assert.equal(task.readOnly, true);
  const resumed = fixture([item('windows', { assignedDeviceId: 'mac', assignedThreadId: thread })]);
  await resumed.projection.apply({ ...task, assignedThreadId: null, type: 'upsert', requestId: 'persisted-return' });
  assert.equal(resumed.mutations[0].type, 'return');
  assert.equal(resumed.mutations[0].expectedRevision, task.expectedRevision);
  await assert.rejects(resumed.projection.apply({ ...task, expectedRevision: null, type: 'delete', requestId: 'no-version' }), /版本已失效/);
});

test('remote attachment failure retains task and disables enqueue while mapped edits restore owner references', async () => {
  const originalInput = [{ type: 'text', text: '原文' }, { type: 'heldImage', id: thread + ':0' }];
  const source = item('windows', { assignedThreadId: thread, assignedDeviceId: 'mac', input: originalInput });
  let fail = true, captures = 0;
  const h = fixture([source], 'connected', { sync: async () => { captures++; },
    prepareRemoteInput: async () => { if (fail) throw Error('图片未同步'); return [{ type: 'text', text: '原文' }, { type: 'heldImage', id: thread + ':1' }]; },
    originalInput: () => originalInput });
  await h.projection.prepare({});
  let [task] = (await h.projection.read(GENERAL)).items;
  assert.equal(task.readOnly, true); assert.match(task.attachmentError, /图片未同步/);
  fail = false; [task] = (await h.projection.read(GENERAL)).items;
  await h.projection.apply({ ...task, type: 'upsert', text: '编辑', requestId: 'edit-picture' });
  assert.deepEqual(h.mutations[0].input, originalInput);
  assert.equal(captures, 1);
});
