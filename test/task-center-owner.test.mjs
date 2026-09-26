import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProjectChecklistStore } from '../src/project-checklist-store.mjs';
import { TaskCenterOwner } from '../src/task-center-owner.mjs';
import { GENERAL_TASK_SCOPE_ID, normalizeTaskCenterAction, taskKey, taskRevision } from '../src/task-center-contract.mjs';

const THREAD = '01a0ac42-2552-7141-8ec9-12c50515ac4a';
const OTHER_THREAD = '01a0ac42-2552-7141-8ec9-12c50515ac4b';
const GENERAL = 'ccc:general-inbox:v1';
const createAction = (extra = {}) => ({ ownerDeviceId: 'mac', id: 'a', requestId: 'create', type: 'create', text: '原任务', ...extra });
const updateAction = (item, type, extra = {}) => ({ ownerDeviceId: item.ownerDeviceId, scopeId: item.scopeId, id: item.id, expectedRevision: item.revision, requestId: type, type, ...extra });
async function reserve(owner, item, extra = {}) {
  return (await owner.apply(updateAction(item, 'verify-delivery', { assignedDeviceId: item.assignedDeviceId, assignedThreadId: item.assignedThreadId, ...extra }))).item;
}
const confirmation = (item, extra = {}) => updateAction(item, 'delivered', { reservationToken: item.deliveryReservation.token, ...extra });
async function setup(t, extra = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'task-center-owner-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const checklistStore = new ProjectChecklistStore(directory);
  const options = { checklistStore, localDevice: { id: 'mac', name: 'Mac' }, verifyTarget: async () => true, ...extra };
  return { directory, checklistStore, owner: new TaskCenterOwner(options), options };
}

test('enumerates unknown project hashes, isolates owners and redacts dispatch audit', async t => {
  const { owner, checklistStore, directory } = await setup(t, { dispatchStore: { list: () => [{ id: 'a', title: '排期', prompt: '排期正文', status: 'sent', targetThreadId: THREAD, activeAttemptId: 'secret', lastError: 'private transcript' }] } });
  await owner.apply(createAction());
  await checklistStore.apply({ projectKey: '/unrecoverable/project/name', id: 'a', requestId: 'project', type: 'upsert', text: '项目任务', done: false, assignedThreadId: THREAD });
  await fs.writeFile(path.join(directory, 'ignore.json'), '{bad');
  const result = await owner.read();
  assert.equal(result.version, 1); assert.equal(result.items.length, 3);
  assert.equal(new Set(result.items.map(item => item.key)).size, 3);
  const project = result.items.find(item => item.text === '项目任务');
  assert.equal(project.scopeId, checklistStore.scopeId('/unrecoverable/project/name'));
  assert.equal(project.assignedDeviceId, 'mac');
  assert.equal(taskKey('mac', project.scopeId, 'a') === taskKey('windows', project.scopeId, 'a'), false);
  const dispatch = result.items.find(item => item.source === 'dispatch');
  assert.equal(dispatch.done, false); assert.equal(dispatch.status, 'sent'); assert.equal(dispatch.executionState, 'delivered');
  assert.equal(JSON.stringify(dispatch).includes('secret'), false); assert.equal(JSON.stringify(dispatch).includes('private transcript'), false);
});

test('full canonical item revision changes for unknown metadata but not object key order', () => {
  assert.equal(taskRevision({ a: 1, b: { c: 2, d: 3 } }), taskRevision({ b: { d: 3, c: 2 }, a: 1 }));
  assert.notEqual(taskRevision({ text: '任务', queueOrder: 1 }), taskRevision({ text: '任务', queueOrder: 2 }));
});

test('CAS actions share the legacy write chain, preserve creation time, metadata and manual order', async t => {
  const { owner, checklistStore } = await setup(t);
  const first = (await owner.apply(createAction())).item;
  await checklistStore.apply({ projectKey: GENERAL, id: 'b', requestId: 'legacy-add', type: 'upsert', text: '第二个', done: false });
  const data = await checklistStore.read(GENERAL);
  data.items[0].queueOrder = 7;
  await fs.writeFile(checklistStore.file(GENERAL), JSON.stringify(data));
  const current = await owner.readTask(first.scopeId, first.id);
  const assigned = (await owner.apply(updateAction(current, 'assign', { assignedDeviceId: 'windows', assignedThreadId: THREAD, text: '领取前编辑' }))).item;
  assert.equal(assigned.done, false); assert.equal(assigned.executionState, null); assert.equal(assigned.createdAt, first.createdAt);
  await owner.apply(confirmation(await reserve(owner, assigned)));
  await checklistStore.apply({ projectKey: GENERAL, id: 'a', assignedThreadId: THREAD, done: false, requestId: 'legacy-edit', type: 'upsert', text: '旧界面编辑' });
  const stored = (await checklistStore.read(GENERAL)).items;
  assert.deepEqual(stored.map(item => item.id), ['a', 'b']);
  assert.equal(stored[0].queueOrder, 7); assert.equal(stored[0].assignedDeviceId, 'windows');
  assert.equal(stored[0].executionState, 'delivered');
  await assert.rejects(owner.apply(updateAction(assigned, 'complete')), { code: 'REVISION_CONFLICT' });
  const recent = await owner.readTask(first.scopeId, first.id);
  const attempts = await Promise.allSettled([
    checklistStore.apply({ projectKey: GENERAL, ...stored[0], requestId: 'race-legacy', type: 'upsert', text: '正在本机修改' }),
    owner.apply(updateAction(recent, 'edit', { text: '旧远端覆盖', requestId: 'race-remote' }))
  ]);
  assert.equal(attempts[0].status, 'fulfilled'); assert.equal(attempts[1].reason.code, 'REVISION_CONFLICT');
});

test('persisted receipts survive restart, later deletion and reject changed payload reuse', async t => {
  const { owner, options, checklistStore } = await setup(t);
  const create = createAction(), original = await owner.apply(create);
  const edit = updateAction(original.item, 'edit', { text: '已修改' });
  const edited = await owner.apply(edit);
  await owner.apply(updateAction(edited.item, 'delete'));
  const restarted = new TaskCenterOwner({ ...options, checklistStore: new ProjectChecklistStore(checklistStore.directory) });
  assert.deepEqual(await restarted.apply(create), original);
  assert.deepEqual(await restarted.apply(edit), edited);
  assert.equal((await restarted.read()).items.length, 0);
  await assert.rejects(restarted.apply({ ...create, text: '另一个任务' }), { code: 'REQUEST_ID_CONFLICT' });
  assert.equal((await checklistStore.read(GENERAL)).taskReceipts.length, 1);
  assert.equal((await fs.readdir(path.join(checklistStore.directory, 'task-receipts'))).length, 2);
});

test('target verification and attachment preparation failures leave exact source data intact', async t => {
  let available = false, prepared = false;
  const { owner, checklistStore } = await setup(t, { verifyTarget: async () => available });
  const input = [{ type: 'text', text: '原任务' }, { type: 'heldImage', id: THREAD + ':0' }];
  const item = (await owner.apply(createAction({ input }))).item;
  const before = await fs.readFile(checklistStore.file(GENERAL), 'utf8');
  const action = updateAction(item, 'assign', { assignedDeviceId: 'windows', assignedThreadId: THREAD });
  await assert.rejects(owner.apply(action), { code: 'TARGET_UNAVAILABLE' });
  available = true;
  await assert.rejects(owner.apply(action), { code: 'CROSS_DEVICE_ATTACHMENTS' });
  owner.prepareAssignment = async () => { throw Error('附件暂不可读'); };
  await assert.rejects(owner.apply(action), /附件暂不可读/);
  assert.equal(await fs.readFile(checklistStore.file(GENERAL), 'utf8'), before);
  owner.prepareAssignment = async value => { assert.deepEqual(value.item.input, input); assert.equal(value.target.deviceId, 'windows'); prepared = true; };
  const assigned = (await owner.apply(action)).item;
  assert.equal(prepared, true); assert.deepEqual(assigned.input, input); assert.equal(assigned.attachmentCount, 1);
});

test('request IDs cannot be reused against another scope after restart', async t => {
  const { owner, checklistStore, options } = await setup(t);
  await owner.apply(createAction());
  await checklistStore.apply({ projectKey: 'project', id: 'a', requestId: 'legacy-project', type: 'upsert', text: '项目任务', done: false });
  const project = (await owner.read()).items.find(item => item.scopeId !== GENERAL_TASK_SCOPE_ID);
  const restarted = new TaskCenterOwner({ ...options, checklistStore: new ProjectChecklistStore(checklistStore.directory) });
  await assert.rejects(restarted.apply(updateAction(project, 'edit', { requestId: 'create', text: '意外覆盖' })), { code: 'REQUEST_ID_CONFLICT' });
  assert.equal((await restarted.readTask(project.scopeId, project.id)).text, '项目任务');
});

test('delivery reservation is durable, exact-target and revision bound; delivery is not completion', async t => {
  const { owner, checklistStore } = await setup(t);
  const item = (await owner.apply(createAction())).item;
  const assigned = (await owner.apply(updateAction(item, 'assign', { assignedDeviceId: 'windows', assignedThreadId: THREAD }))).item;
  const guard = updateAction(assigned, 'verify-delivery', { assignedDeviceId: 'windows', assignedThreadId: THREAD });
  await assert.rejects(owner.apply({ ...guard, assignedDeviceId: 'mac', requestId: 'wrong-target' }), { code: 'TARGET_MISMATCH' });
  const reserved = (await owner.apply(guard)).item;
  assert.notEqual(reserved.revision, assigned.revision);
  assert.deepEqual((await owner.apply(guard)).item, reserved);
  assert.equal((await checklistStore.read(GENERAL)).items[0].deliveryReservation.token, reserved.deliveryReservation.token);
  const delivered = (await owner.apply(confirmation(reserved))).item;
  assert.equal(delivered.done, false); assert.equal(delivered.executionState, 'delivered');
  assert.equal(delivered.deliveryReservation, undefined);
  await assert.rejects(owner.apply(guard), { code: 'RESERVATION_CLOSED' });
  await assert.rejects(owner.apply(updateAction(delivered, 'verify-delivery', { requestId: 'guard-again', assignedDeviceId: 'windows', assignedThreadId: THREAD })), { code: 'TASK_NOT_PENDING' });
  const completed = (await owner.apply(updateAction(delivered, 'complete'))).item;
  assert.equal(completed.done, true);
  const reopened = (await owner.apply(updateAction(completed, 'reopen'))).item;
  assert.equal(reopened.done, false); assert.equal(reopened.executionState, null);
  const returned = (await owner.apply(updateAction(reopened, 'return'))).item;
  assert.equal(returned.assignedThreadId, null); assert.equal(returned.assignedDeviceId, null);
});

test('new-thread delivered acknowledgement atomically records content and verified relationship', async t => {
  const checked = [], { owner } = await setup(t, { verifyTarget: async target => { checked.push(target); return true; } });
  const item = (await owner.apply(createAction())).item;
  const reserved = await reserve(owner, item, { assignedDeviceId: 'mac', assignedThreadId: null });
  const delivered = (await owner.apply(confirmation(reserved, { assignedDeviceId: 'mac', assignedThreadId: OTHER_THREAD, text: '实际发送内容', input: [{ type: 'text', text: '过时输入' }] }))).item;
  assert.deepEqual(checked, [{ provider: 'codex', deviceId: 'mac', threadId: null }, { provider: 'codex', deviceId: 'mac', threadId: OTHER_THREAD }]);
  assert.equal(delivered.assignedThreadId, OTHER_THREAD); assert.equal(delivered.text, '实际发送内容');
  assert.deepEqual(delivered.input, [{ type: 'text', text: '实际发送内容' }]);
  assert.equal(delivered.done, false); assert.equal(delivered.executionState, 'delivered');
});

test('two windows cannot reserve the same delivery and uncertainty stays locked across restart', async t => {
  const { owner, options, checklistStore } = await setup(t);
  const item = (await owner.apply(createAction())).item;
  const assigned = (await owner.apply(updateAction(item, 'assign', { assignedDeviceId: 'windows', assignedThreadId: THREAD }))).item;
  const actions = ['window-a', 'window-b'].map(requestId => updateAction(assigned, 'verify-delivery', { requestId, assignedDeviceId: 'windows', assignedThreadId: THREAD }));
  const attempts = await Promise.allSettled(actions.map(action => owner.apply(action)));
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(attempts.find(result => result.status === 'rejected').reason.code, 'REVISION_CONFLICT');
  const reserved = attempts.find(result => result.status === 'fulfilled').value.item;
  const restarted = new TaskCenterOwner({ ...options, checklistStore: new ProjectChecklistStore(checklistStore.directory) });
  const receiptAction = actions.find(action => action.requestId === reserved.deliveryReservation.requestId);
  assert.deepEqual((await restarted.apply(receiptAction)).item, reserved);
  const before = await fs.readFile(checklistStore.file(GENERAL), 'utf8');
  await assert.rejects(reserve(restarted, reserved, { requestId: 'new-window' }), { code: 'DELIVERY_RESERVED' });
  for (const type of ['edit', 'assign', 'return', 'complete', 'reopen', 'delete']) {
    await assert.rejects(restarted.apply(updateAction(reserved, type, { requestId: 'locked-' + type, text: '不能覆盖', assignedDeviceId: 'mac', assignedThreadId: OTHER_THREAD })), { code: 'DELIVERY_RESERVED' });
  }
  await assert.rejects(checklistStore.apply({ projectKey: GENERAL, id: 'a', requestId: 'legacy-race', type: 'upsert', text: '旧窗口覆盖', done: false }), { code: 'DELIVERY_RESERVED' });
  await assert.rejects(restarted.apply(confirmation(reserved, { reservationToken: OTHER_THREAD })), { code: 'RESERVATION_MISMATCH' });
  await assert.rejects(restarted.apply(confirmation(reserved, { assignedDeviceId: 'mac', assignedThreadId: THREAD })), { code: 'TARGET_MISMATCH' });
  assert.equal(await fs.readFile(checklistStore.file(GENERAL), 'utf8'), before);
});

test('new-thread reservation rejects a competing claim and requires a verified resulting thread', async t => {
  let valid = true;
  const { owner } = await setup(t, { verifyTarget: async () => valid });
  const item = (await owner.apply(createAction())).item;
  const reserved = await reserve(owner, item, { requestId: 'new-thread-reserve', assignedDeviceId: 'windows', assignedThreadId: null });
  await assert.rejects(reserve(owner, item, { requestId: 'other-device', assignedDeviceId: 'mac', assignedThreadId: null }), { code: 'REVISION_CONFLICT' });
  await assert.rejects(owner.apply(confirmation(reserved)), { code: 'TARGET_MISMATCH' });
  valid = false;
  await assert.rejects(owner.apply(confirmation(reserved, { assignedDeviceId: 'windows', assignedThreadId: THREAD })), { code: 'TARGET_UNAVAILABLE' });
  assert.ok((await owner.readTask(item.scopeId, item.id)).deliveryReservation);
  valid = true;
  const delivered = (await owner.apply(confirmation(reserved, { assignedDeviceId: 'windows', assignedThreadId: THREAD }))).item;
  assert.equal(delivered.assignedDeviceId, 'windows'); assert.equal(delivered.assignedThreadId, THREAD);
  assert.equal(delivered.done, false); assert.equal(delivered.executionState, 'delivered');
});

test('only explicit matching-token release frees a known pre-send reservation', async t => {
  const { owner } = await setup(t);
  const item = (await owner.apply(createAction())).item;
  const reserved = await reserve(owner, item, { assignedDeviceId: 'mac', assignedThreadId: null });
  const release = updateAction(reserved, 'release-delivery', { reservationToken: reserved.deliveryReservation.token });
  await assert.rejects(owner.apply({ ...release, reservationToken: OTHER_THREAD }), { code: 'RESERVATION_MISMATCH' });
  const released = (await owner.apply(release)).item;
  assert.equal(released.deliveryReservation, undefined); assert.equal(released.done, item.done);
  assert.equal(released.assignedThreadId, null); assert.equal(released.executionState, null);
  assert.notEqual(released.revision, reserved.revision);
  const again = await reserve(owner, released, { requestId: 'new-reservation', assignedDeviceId: 'mac', assignedThreadId: null });
  assert.notEqual(again.deliveryReservation.token, reserved.deliveryReservation.token);
  await owner.apply(release);
  assert.equal((await owner.readTask(item.scopeId, item.id)).deliveryReservation.token, again.deliveryReservation.token);
});

test('legacy native creation cannot overwrite an existing item even under a race', async t => {
  const { checklistStore } = await setup(t);
  const action = { projectKey: GENERAL, id: 'a', requestId: 'native-create', type: 'upsert', text: '唯一新增', done: false, creation: true };
  const attempts = await Promise.allSettled([checklistStore.apply(action), checklistStore.apply({ ...action, requestId: 'other-window', text: '覆盖' })]);
  assert.equal(attempts[0].status, 'fulfilled'); assert.equal(attempts[1].reason.code, 'TASK_EXISTS');
  assert.equal(await checklistStore.apply(action), action.requestId);
  assert.equal((await checklistStore.read(GENERAL)).items[0].text, '唯一新增');
});

test('invalid scopes, metadata, unsupported dispatch writes and symlinks fail closed', async t => {
  const { owner, checklistStore, directory } = await setup(t);
  for (const patch of [{ scopeId: '../escape' }, { executionState: 'completed' }, { assignedDeviceId: 42 }, { done: 'yes' }, { expectedRevision: 'bad' }, { scopeId: 'dispatch' }]) {
    assert.throws(() => normalizeTaskCenterAction(createAction(patch)));
  }
  await assert.rejects(owner.apply(createAction({ ownerDeviceId: 'wrong-owner' })), { code: 'WRONG_OWNER' });
  const outside = path.join(directory, 'outside.json');
  await fs.writeFile(outside, JSON.stringify({ version: 1, items: [], receipts: [] }));
  await fs.symlink(outside, checklistStore.file(GENERAL));
  await assert.rejects(checklistStore.readScope(GENERAL_TASK_SCOPE_ID), /符号链接/);
  await assert.rejects(owner.apply(createAction()), /符号链接/);
  assert.equal((await checklistStore.listScopes()).length, 0);
  assert.deepEqual(JSON.parse(await fs.readFile(outside, 'utf8')).items, []);
  const linkedDirectory = path.join(directory, 'linked'); await fs.symlink(directory, linkedDirectory);
  await assert.rejects(new ProjectChecklistStore(linkedDirectory).read(GENERAL), /符号链接/);
});
