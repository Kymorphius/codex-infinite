import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProjectChecklistStore } from '../src/project-checklist-store.mjs';
import { TaskCenterOwner } from '../src/task-center-owner.mjs';
import { TaskCenterFederation } from '../src/task-center-federation.mjs';
import { TaskCenterChecklistProjection } from '../src/task-center-checklist-projection.mjs';
import { createTaskCenterRuntime } from '../src/task-center-runtime.mjs';
import { normalizeTaskCenterAction, GENERAL_TASK_SCOPE_ID } from '../src/task-center-contract.mjs';
import { assignedChecklistTasksForThread } from '../src/project-checklist-assignment.mjs';
import { normalizeAssignedChecklistTasks } from '../src/native-assigned-checklist-tasks.mjs';
import { createNativeChecklistTaskModel } from '../src/native-checklist-unified-task.mjs';
import { createChecklistDeliveryBridge } from '../src/native-checklist-delivery.mjs';
import { assignmentTargets, sessionKey, matchesTaskDestination, taskDestination } from '../public/features/task-center/model.js';
import { createTaskCenterController } from '../public/features/task-center/controller.js';

const threadId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', localDevice = { id: 'mac', name: 'Mac' };
const scopeId = GENERAL_TASK_SCOPE_ID, generalKey = 'ccc:general-inbox:v1';
const create = extra => ({ type: 'create', ownerDeviceId: 'mac', id: 'task', requestId: 'create', text: '共同待办', ...extra });
const action = (item, type, extra) => ({ type, ownerDeviceId: item.ownerDeviceId, scopeId: item.scopeId,
  id: item.id, requestId: type, expectedRevision: item.revision, ...extra });
const target = { assignedProvider: 'terminal', assignedDeviceId: 'mac', assignedThreadId: threadId };
async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'task-provider-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new ProjectChecklistStore(directory), checked = [];
  const owner = new TaskCenterOwner({ checklistStore: store, localDevice,
    verifyTarget: async value => { checked.push(value); return true; }, ...options });
  return { directory, store, owner, checked };
}

test('terminal assignment persists beside shared tasks, survives restart and respects provider CAS', async t => {
  const { owner, store, checked } = await fixture(t);
  const created = (await owner.apply(create())).item;
  const assigned = (await owner.apply(action(created, 'assign', target))).item;
  assert.equal(assigned.assignedProvider, 'terminal');
  assert.deepEqual(checked, [{ provider: 'terminal', deviceId: 'mac', threadId }]);
  assert.equal((await store.read(generalKey)).items[0].assignedProvider, 'terminal');
  const restarted = new TaskCenterOwner({ checklistStore: new ProjectChecklistStore(store.directory), localDevice, verifyTarget: async () => true });
  const read = await restarted.read();
  assert.deepEqual(read.supportedProviders, ['codex', 'terminal']);
  assert.equal(read.items[0].assignedProvider, 'terminal');
  await assert.rejects(restarted.apply(action(assigned, 'verify-delivery', { assignedDeviceId: 'mac', assignedThreadId: threadId })), { code: 'TARGET_MISMATCH' });
  const reserved = (await restarted.apply(action(assigned, 'verify-delivery', { ...target, requestId: 'terminal-reserve' }))).item;
  assert.equal(reserved.deliveryReservation.assignedProvider, 'terminal');
  await assert.rejects(restarted.apply(action(reserved, 'delivered', { ...target, assignedProvider: 'codex', reservationToken: reserved.deliveryReservation.token })), { code: 'TARGET_MISMATCH' });
  const released = (await restarted.apply(action(reserved, 'release-delivery', { reservationToken: reserved.deliveryReservation.token }))).item;
  const returned = (await restarted.apply(action(released, 'return'))).item;
  assert.equal(returned.assignedThreadId, null); assert.equal(returned.assignedProvider, null);
  await assert.rejects(owner.apply(action(assigned, 'complete')), { code: 'REVISION_CONFLICT' });
});

test('invalid providers fail closed and legacy assignments default only to Codex', () => {
  const base = action({ ownerDeviceId: 'mac', scopeId, id: 'task', revision: 'a'.repeat(64) }, 'assign', target);
  for (const assignedProvider of ['', 'shell', 'claude', 1, null]) assert.throws(() => normalizeTaskCenterAction({ ...base, assignedProvider }), { code: 'INVALID_PROVIDER' });
  const { assignedProvider: ignored, ...legacy } = base;
  assert.equal(normalizeTaskCenterAction(legacy).assignedProvider, 'codex');
});

test('image assignment to a terminal preserves the entire original task and attachments', async t => {
  const { owner, store } = await fixture(t);
  const input = [{ type: 'text', text: '共同待办' }, { type: 'heldImage', id: threadId + ':0' }];
  const created = (await owner.apply(create({ input }))).item;
  const before = await store.read(generalKey);
  await assert.rejects(owner.apply(action(created, 'assign', target)), { code: 'TERMINAL_ATTACHMENTS_UNSUPPORTED' });
  assert.deepEqual(await store.read(generalKey), before);
  const plain = (await owner.apply(create({ id: 'plain', requestId: 'plain' }))).item;
  const assigned = (await owner.apply(action(plain, 'assign', { ...target, requestId: 'plain-assign' }))).item;
  await assert.rejects(owner.apply(action(assigned, 'edit', { text: '加图片', input })), { code: 'TERMINAL_ATTACHMENTS_UNSUPPORTED' });
  assert.equal((await owner.readTask(scopeId, 'plain')).revision, assigned.revision);
});

test('native projection and final queue normalization exclude colliding terminal IDs', async t => {
  const { owner, store } = await fixture(t);
  const created = (await owner.apply(create())).item;
  await owner.apply(action(created, 'assign', target));
  await store.apply({ projectKey: generalKey, type: 'upsert', id: 'native-task', requestId: 'legacy', text: '原生会话', done: false, assignedThreadId: threadId });
  const snapshot = await owner.read(), all = snapshot.items;
  assert.deepEqual(assignedChecklistTasksForThread(all, threadId).map(item => item.id), ['native-task']);
  assert.deepEqual(normalizeAssignedChecklistTasks(all).map(item => item.id), ['native-task']);
  const model = createNativeChecklistTaskModel({ generalKey, readGeneralItems: () => all, readPending: () => [] });
  assert.deepEqual(model.tasksForThread(threadId).map(item => item.id), ['native-task']);
  const bridge = createChecklistDeliveryBridge({ readItems: () => all, enqueue: () => assert.fail('terminal task reached native queue') });
  await assert.rejects(bridge.prepare('task', threadId, null, 'request'), /状态已变化/);
  const projection = new TaskCenterChecklistProjection({ store, localDevice,
    service: { read: async () => ({ devices: [{ ...snapshot, status: 'connected' }] }) } });
  assert.deepEqual((await projection.read(generalKey)).items.map(item => item.id), ['native-task']);
  assert.equal((await owner.read()).items.length, 2);
});

test('runtime resolves stable terminal identity without consulting native task IDs', async t => {
  const { store, directory } = await fixture(t);
  let archived = false, calls = 0, nativeReads = 0;
  const { owner } = createTaskCenterRuntime({ config: { wrapperCodexHome: directory, peerActionKeyDirectory: directory, nodeDevice: localDevice },
    checklistStore: store, peers: [], adapter: { listTasks: async () => { nativeReads++; return { devices: [{ ...localDevice, status: 'connected' }], tasks: [{ id: threadId, device: localDevice }] }; } },
    terminalConversations: { open: async value => { assert.deepEqual(value, { id: threadId }); calls++; return { id: threadId, provider: 'terminal', deviceId: 'mac', archived }; } } });
  const created = (await owner.apply(create())).item;
  const assigned = (await owner.apply(action(created, 'assign', target))).item;
  assert.equal(calls, 1); assert.equal(nativeReads, 0);
  archived = true;
  await assert.rejects(owner.apply(action(assigned, 'assign', { ...target, requestId: 'archived' })), { code: 'TARGET_UNAVAILABLE' });
  await assert.rejects(owner.apply(action(assigned, 'assign', { ...target, assignedDeviceId: 'windows', requestId: 'remote' })), { code: 'TARGET_UNAVAILABLE' });
  const native = (await owner.apply(action(assigned, 'assign', { ...target, assignedProvider: 'codex', requestId: 'native' }))).item;
  assert.equal(native.assignedProvider, 'codex'); assert.equal(nativeReads, 1);
});

test('remote owners cannot accept local terminal assignments even when upgraded', async () => {
  let supportedProviders, writes = 0;
  const item = { source: 'checklist', ownerDeviceId: 'win', scopeId, id: 'task', text: 'remote', revision: 'a'.repeat(64) };
  const service = new TaskCenterFederation({ localDevice, localOwner: { read: async () => ({ version: 1, device: localDevice, items: [] }) },
    peers: [{ peer: { id: 'win', name: 'Win' }, taskCenter: {
      read: async () => ({ version: 1, device: { id: 'win' }, items: [item], ...(supportedProviders ? { supportedProviders } : {}) }),
      apply: async input => { writes++; Object.assign(item, target); return { applied: true, requestId: input.requestId, item }; }
    } }] });
  const assign = action(item, 'assign', target);
  await assert.rejects(service.apply(assign), { code: 'UNSUPPORTED_PROVIDER' }); assert.equal(writes, 0);
  supportedProviders = ['codex', 'terminal'];
  await assert.rejects(service.apply(assign), { code: 'UNSUPPORTED_PROVIDER' }); assert.equal(writes, 0);
});

test('target picker and opening keep equal device/session IDs separate by provider', async () => {
  const tasks = ['codex', 'terminal'].map(provider => ({ provider, id: threadId, device: { ...localDevice, status: 'connected' } }));
  const item = { source: 'checklist', ownerDeviceId: 'mac', scopeId, id: 'task', key: 'task', text: '任务', revision: 'a'.repeat(64) };
  const catalog = { version: 1, localDeviceId: 'mac', devices: [{ device: localDevice, status: 'connected', items: [item] }] };
  assert.equal(assignmentTargets(tasks, catalog).length, 2);
  assert.notEqual(sessionKey(tasks[0]), sessionKey(tasks[1]));
  const destination = taskDestination({ ...item, ...target });
  assert.equal(matchesTaskDestination(tasks[0], destination), false);
  assert.equal(matchesTaskDestination(tasks[1], destination), true);
  const writes = [];
  const controller = createTaskCenterController({ tasks: () => tasks,
    request: async (url, options) => { if (!options) return catalog; writes.push(options.body); return { applied: true, requestId: options.body.requestId }; },
    randomUUID: () => 'request' });
  await controller.load(); controller.edit('assign', 'task'); controller.draft({ target: sessionKey(tasks[1]) });
  assert.equal(await controller.submit(), true);
  assert.equal(writes[0].assignedProvider, 'terminal');
});

test('task editor blocks image claims and incapable remote owners before mutation', async () => {
  for (const mode of ['image', 'old-owner']) {
    const ownerId = mode === 'image' ? 'mac' : 'win';
    const item = { source: 'checklist', ownerDeviceId: ownerId, scopeId, id: 'task', key: 'task', text: '任务',
      revision: 'a'.repeat(64), ...(mode === 'image' ? { attachmentCount: 1 } : {}) };
    const catalog = { version: 1, localDeviceId: 'mac', devices: [
      { device: localDevice, status: 'connected', items: ownerId === 'mac' ? [item] : [] },
      { device: { id: 'win' }, status: 'connected', items: ownerId === 'win' ? [item] : [] }
    ] };
    const task = { provider: 'terminal', id: threadId, device: localDevice }; let writes = 0;
    const controller = createTaskCenterController({ tasks: () => [task], randomUUID: () => 'request',
      request: async (url, options) => { if (!options) return catalog; writes++; return {}; } });
    await controller.load(); controller.edit('assign', 'task'); controller.draft({ target: sessionKey(task) });
    assert.equal(await controller.submit(), false); assert.equal(writes, 0);
    assert.match(controller.getState().error, mode === 'image' ? /图片/ : /本机来源/);
  }
});
