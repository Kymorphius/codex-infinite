import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildNativeProjectChecklistScript } from '../src/native-project-checklist.mjs';
import { readNativeChecklistHeldTodos } from '../src/native-checklist-held-todos.mjs';
import { readNativeChecklistConversationChoices } from '../src/native-checklist-conversation-choices.mjs';
import { ProjectChecklistStore } from '../src/project-checklist-store.mjs';
import { assignedChecklistTasksForThread } from '../src/project-checklist-assignment.mjs';
function harness(saved = '[]', conversationRows = []) {
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.listeners = {}; this.value = ''; }
    append(...nodes) { for (const node of nodes) if (node && typeof node === 'object') node.parent = this; this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
    replaceWith(...nodes) { const index = this.parent?.children.indexOf(this) ?? -1; if (index >= 0) { for (const node of nodes) if (node && typeof node === 'object') node.parent = this.parent; this.parent.children.splice(index, 1, ...nodes); } }
    setAttribute(k, v) { this.attrs[k] = v; }
    addEventListener(k, fn) { this.listeners[k] = fn; }
    focus() {} remove() {} showModal() { this.open = true; } close() { this.open = false; }
  }
  let storage = saved, id = 0;
  const document = { body: new Node('body'), head: new Node('head'), createElement: tag => new Node(tag), querySelectorAll: () => conversationRows };
  const context = vm.createContext({ document, window: { addEventListener() {}, removeEventListener() {} }, crypto: { randomUUID: () => 'id-' + ++id }, localStorage: { getItem: () => storage, setItem: (_, v) => { storage = v; } } });
  vm.runInContext(buildNativeProjectChecklistScript(), context);
  return { api: context.window.__cccProjectChecklist, dialog: document.body.children[0], storage: () => storage };
}
test('ack advances only unsent dependent revisions and conflicts keep a visible draft without blocking sync', () => {
  const sourceRef = { ownerDeviceId: 'windows', scopeId: 'a'.repeat(64), id: 'remote' }, projectKey = 'ccc:general-inbox:v1';
  const task = { id: 'federated-remote', text: '原文', done: false, assignedThreadId: null, sourceRef, expectedRevision: 'old' };
  const pending = ['first', 'second'].map(requestId => ({ ...task, text: requestId, projectKey, type: 'upsert', requestId }));
  const h = harness(JSON.stringify(pending)); h.api.cacheGeneral([task]); h.api.openGeneral();
  h.api.accept({ projectKey, items: [{ ...task, text: 'first', expectedRevision: 'new' }], acknowledged: ['first'], actionResults: [{ requestId: 'first', projectKey, id: task.id, previousRevision: 'old', item: { ...sourceRef, revision: 'new' } }] });
  assert.equal(h.api.packet().actions[0].expectedRevision, 'new');
  h.api.accept({ projectKey, items: [{ ...task, text: '远端新内容', expectedRevision: 'remote-revision' }], acknowledged: [], conflicts: [{ requestId: 'second', projectKey, id: task.id, error: '任务在其他设备修改' }] });
  assert.equal(h.api.packet().actions.length, 0);
  const saved = JSON.parse(h.storage()); assert.equal(saved[0].text, 'second'); assert.equal(saved[0].conflict, '任务在其他设备修改');
  const recovery = h.dialog.children.at(-1); assert.equal(recovery.hidden, false);
  assert.match(recovery.children[0].textContent, /1 项更改未保存/);
  assert.equal(recovery.children[1].children[0].children[1].value, 'second');
});
test('native checklist adds, edits, completes and deletes while acknowledging without replacing in-progress input', () => {
  const h = harness(); h.api.open({ key: 'p', name: '项目' });
  const form = h.dialog.children[2], input = form.children[0], list = h.dialog.children[4];
  assert.equal(input.disabled, true);
  h.api.accept({ projectKey: 'p', items: [], acknowledged: [] });
  input.value = '做一件事'; form.listeners.submit({ preventDefault() {} });
  let packet = h.api.packet(); assert.equal(packet.actions.length, 1);
  const action = packet.actions[0], row = list.children[0]; row.children[1].value = '尚未失去焦点的编辑';
  h.api.accept({ projectKey: 'p', items: [{ id: action.id, text: action.text, done: false, createdAt: action.createdAt, updatedAt: 'now' }], acknowledged: [action.requestId] });
  assert.notEqual(list.children[0], row); assert.equal(list.children[0].children[1].value, '尚未失去焦点的编辑');
  list.children[0].children[1].listeners.change();
  assert.equal(h.api.packet().actions[0].text, '尚未失去焦点的编辑');
  list.children[0].children[0].checked = true; list.children[0].children[0].listeners.change();
  assert.equal(h.api.packet().actions.at(-1).done, true);
  list.children[0].children[2].listeners.click(); assert.equal(h.api.packet().actions.at(-1).type, 'delete');
  assert.equal(JSON.parse(h.storage()).length, 3);
});
test('checklist numbers have a separate small card beside the task card', () => {
  const source = buildNativeProjectChecklistScript();
  assert.match(source, /ul\{list-style:none;padding:0;padding-inline-start:48px/);
  assert.match(source, /li\[data-checklist-row\]::before\{content:counter\(task\);position:absolute;inset-inline-start:-44px/);
  assert.match(source, /width:32px;height:34px;border-radius:9px;background:#8882/);
  assert.match(source, /2026-09-26\.federated/);
  assert.match(source, /checklistTaskId/);
});
test('project switching isolates visible items and restores pending drafts after reload', () => {
  const pending = [{ projectKey: 'a', type: 'upsert', id: 'item', requestId: 'req', text: '保留草稿', done: false }];
  const h = harness(JSON.stringify(pending)); h.api.open({ key: 'b' });
  h.api.accept({ projectKey: 'b', items: [], acknowledged: [] });
  assert.match(h.dialog.children[4].children[0].textContent, /还没有/);
  h.api.open({ key: 'a' }); h.api.accept({ projectKey: 'a', items: [], acknowledged: [] });
  assert.equal(h.dialog.children[4].children[0].children[1].value, '保留草稿');
});

test('general inbox opens without project and keeps actions separate from project lists', () => {
  const h = harness(); h.api.openGeneral();
  assert.equal(h.dialog.attrs['aria-label'], '综合任务清单');
  assert.equal(h.api.packet().projectKey, 'ccc:general-inbox:v1');
  h.api.accept({ projectKey: 'ccc:general-inbox:v1', items: [], acknowledged: [] });
  const form = h.dialog.children[2]; form.children[0].value = '还没确定谁来做'; form.listeners.submit({ preventDefault() {} });
  assert.equal(h.api.packet().actions[0].projectKey, 'ccc:general-inbox:v1');
  h.api.open({ key: 'project-a', name: '项目 A' });
  h.api.accept({ projectKey: 'project-a', items: [], acknowledged: [] });
  assert.equal(h.dialog.attrs['aria-label'], '项目任务清单');
  assert.match(h.dialog.children[4].children[0].textContent, /还没有/);
  h.api.openGeneral(); h.api.accept({ projectKey: 'ccc:general-inbox:v1', items: [], acknowledged: [] });
  assert.equal(h.dialog.children[4].children[0].children[1].value, '还没确定谁来做');
});

test('general inbox opens from the proactively published snapshot without waiting for a read', () => {
  const h = harness(); h.api.cacheGeneral([{ id: 'cached', text: '立即显示', done: false, assignedThreadId: null }]); h.api.openGeneral();
  assert.equal(h.dialog.children[2].children[0].disabled, false);
  assert.equal(h.dialog.children[4].children[0].children[1].value, '立即显示');
});

test('delivered assigned task persists delivery without completing the task', () => {
  const task = { id: 'assigned', text: '入队后不再是待办', done: false, assignedThreadId: 'thread-a' };
  const h = harness(); h.api.cacheGeneral([task]);
  assert.equal(h.api.completeAssignedTask(task.id, task.assignedThreadId, task.text), true);
  assert.equal(h.api.packet().actions.at(-1).done, false);
  assert.equal(h.api.packet().actions.at(-1).executionState, 'delivered');
  assert.equal(h.api.completeAssignedTask(task.id, task.assignedThreadId, task.text), false);
});

test('assigned general tasks leave the main list and expose reassignment in the lower todo projection', () => {
  const threadId = '01a0ac42-2552-7141-8ec9-12c50515ac4a';
  const row = { getAttribute: name => name.includes('thread-id') ? 'local:' + threadId : '当前会话', textContent: '当前会话' };
  const h = harness('[]', [row]); h.api.cacheGeneral([{ id: 'task', text: '准备发送', done: false, assignedThreadId: null }]); h.api.openGeneral();
  const list = h.dialog.children[4]; list.children[0].children[2].listeners.click();
  list.children[0].children[2].value = threadId; list.children[0].children[3].listeners.click();
  assert.equal(list.children.length, 1);
  assert.equal(list.children[0].children[0].textContent, '会话待办');
  assert.equal(list.children[0].children[2].textContent, '改派会话');
});

test('native conversation choices normalize only local UUID rows', () => {
  const id = '01a0ac42-2552-7141-8ec9-12c50515ac4a';
  const rows = [{ getAttribute: name => name.includes('thread-id') ? 'local:' + id.toUpperCase() : '会话 A', textContent: 'fallback' }, { getAttribute: () => 'remote:bad', textContent: 'bad' }];
  assert.deepEqual(readNativeChecklistConversationChoices({ querySelectorAll: () => rows }), [{ id, title: '会话 A' }]);
});

test('general checklist projects held composer todos without copying them into editable checklist actions', () => {
  const threadId = '01a0ac42-2552-7141-8ec9-12c50515ac4a', todoId = 'cafcb830-d98c-40e9-9240-39e11ed11d7b';
  const storage = { getItem: () => JSON.stringify({ [threadId]: [{ id: todoId, summary: '只保留在会话待办里', heldAt: 1, origin: 'draft' }] }) };
  assert.deepEqual(readNativeChecklistHeldTodos(storage), [{ id: todoId, threadId, text: '只保留在会话待办里', heldAt: 1, origin: '直存待办' }]);
  const source = buildNativeProjectChecklistScript();
  assert.match(source, /会话待办/);
  assert.match(source, /打开会话/);
  assert.match(source, /codex-control-console-held-todos-changed/);
  assert.match(source, /__codexControlConsoleOpenNativeThread/);
  assert.match(source, /requestIdleCallback/);
  assert.match(source, /正在加载会话待办/);
  assert.match(source, /scheduleHeldLoad/);
});

test('general checklist can assign or claim an unassigned task without sending it', () => {
  const source = buildNativeProjectChecklistScript();
  assert.match(source, /指派会话/);
  assert.match(source, /openClaimableForCurrentThread/);
  assert.match(source, /领取不会发送消息/);
  assert.match(source, /assignedThreadId/);
  assert.match(source, /completeAssignedTask/);
  assert.match(source, /选择指派会话/);
  assert.match(source, /确认/);
  assert.match(source, /取消/);
  assert.doesNotMatch(source, /window\.prompt/);
});

const generalKey = 'ccc:general-inbox:v1';
const threadA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', threadB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

test('claim clicks keep task identity through reordered rows, persistence and the todo projection', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'checklist-claim-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new ProjectChecklistStore(directory);
  const taskA = { id: 'task-a', text: '领取这一个任务', done: false, assignedThreadId: null };
  const taskB = { id: 'task-b', text: '不要领取另一个任务', done: false, assignedThreadId: null };
  for (const item of [taskA, taskB]) await store.apply({ ...item, projectKey: generalKey, type: 'upsert', requestId: 'seed-' + item.id });
  const h = harness(); h.api.cacheGeneral([taskA, taskB]); h.api.openClaimableForCurrentThread(threadA);
  const list = h.dialog.children[4], staleClaimA = list.children[0].children[1];
  h.api.accept({ projectKey: generalKey, items: [taskB, taskA], acknowledged: [] });
  staleClaimA.listeners.click();
  assert.equal(h.api.packet().actions.length, 0);
  assert.equal(list.children[1].children[0].value, taskA.text);
  list.children[1].children[1].listeners.click();
  const actions = h.api.packet().actions;
  assert.equal(actions.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(actions[0])), { ...taskA, assignedThreadId: threadA, projectKey: generalKey, type: 'upsert', requestId: 'id-1' });
  await store.apply(actions[0]);
  const saved = (await new ProjectChecklistStore(directory).read(generalKey)).items;
  assert.deepEqual(assignedChecklistTasksForThread(saved, threadA), [{ id: taskA.id, text: taskA.text, createdAt: saved.find(item => item.id === taskA.id).createdAt }]);
  assert.equal(saved.find(item => item.id === taskB.id).assignedThreadId, null);
  assert.equal(saved.find(item => item.id === taskB.id).text, taskB.text);
});

test('a claim callback from an earlier dialog cannot use the newly selected claim target or project', () => {
  const h = harness(), task = { id: 'task-a', text: '绑定领取目标', done: false };
  h.api.cacheGeneral([task]); h.api.openClaimableForCurrentThread(threadA);
  const list = h.dialog.children[4], staleClaimA = list.children[0].children[1];
  h.api.open({ key: 'another-project' }); staleClaimA.listeners.click();
  assert.equal(h.api.packet().actions.length, 0);
  h.api.openClaimableForCurrentThread(threadB); staleClaimA.listeners.click();
  assert.equal(h.api.packet().actions.length, 0);
  list.children[0].children[1].listeners.click();
  const [action] = h.api.packet().actions;
  assert.equal(action.id, task.id); assert.equal(action.text, task.text);
  assert.equal(action.projectKey, generalKey); assert.equal(action.assignedThreadId, threadB);
});

test('a newer general snapshot prevents a visible stale claim from overwriting reassignment or text', () => {
  for (const update of [{ assignedThreadId: threadB }, { text: '已经修改的内容' }, { done: true }]) {
    const h = harness(), task = { id: 'task-a', text: '旧的内容', done: false, assignedThreadId: null };
    h.api.cacheGeneral([task]); h.api.openClaimableForCurrentThread(threadA);
    const claim = h.dialog.children[4].children[0].children[1];
    h.api.cacheGeneral([{ ...task, ...update }]); claim.listeners.click();
    assert.equal(h.api.packet().actions.length, 0, JSON.stringify(update));
  }
});

test('resuming an assigned general task completes its exact identity while another project is open', () => {
  const h = harness(), generalTask = { id: 'shared-id', text: '综合清单中的任务', done: false, assignedThreadId: threadA };
  h.api.cacheGeneral([generalTask]); h.api.open({ key: 'another-project' });
  const projectTask = { id: 'shared-id', text: '另一个项目中同 ID 的任务', done: false, assignedThreadId: threadB };
  h.api.accept({ projectKey: 'another-project', items: [projectTask], acknowledged: [] });
  assert.equal(h.api.completeAssignedTask(generalTask.id, threadA, generalTask.text), true);
  const [action] = h.api.packet().actions;
  assert.equal(action.projectKey, generalKey); assert.equal(action.id, generalTask.id);
  assert.equal(action.text, generalTask.text); assert.equal(action.assignedThreadId, threadA); assert.equal(action.done, false); assert.equal(action.executionState, 'delivered');
  assert.equal(h.dialog.children[4].children[0].children[1].value, projectTask.text);
  assert.equal(h.dialog.children[4].children[0].children[0].checked, false);
  assert.equal(h.api.completeAssignedTask(generalTask.id, threadA, generalTask.text), false);
  assert.equal(h.api.packet().actions.length, 1);
});

test('assigned completion resolves general pending changes without using same-ID project pending actions', () => {
  const task = { id: 'shared-id', text: '原来的任务', done: false, assignedThreadId: threadA };
  const changed = { ...task, text: '修改且改派后的任务', assignedThreadId: threadB };
  const pending = [
    { ...changed, projectKey: generalKey, type: 'upsert', requestId: 'general-edit' },
    { ...task, projectKey: 'another-project', type: 'upsert', requestId: 'project-edit' }
  ];
  const h = harness(JSON.stringify(pending)); h.api.cacheGeneral([task]); h.api.open({ key: 'another-project' });
  assert.equal(h.api.completeAssignedTask(task.id, threadA, task.text), false);
  assert.equal(h.api.completeAssignedTask(task.id, threadB, task.text), false);
  assert.equal(h.api.completeAssignedTask(task.id, threadA, changed.text), false);
  assert.equal(h.api.packet().actions.length, 2);
  assert.equal(h.api.completeAssignedTask(task.id, threadB, changed.text), true);
  const action = h.api.packet().actions.at(-1);
  assert.equal(action.projectKey, generalKey); assert.equal(action.assignedThreadId, threadB);
  assert.equal(action.text, changed.text); assert.equal(action.done, false); assert.equal(action.executionState, 'delivered');
});

test('assigned completion rejects completed, removed, unassigned and changed tasks', () => {
  const task = { id: 'task-a', text: '原来的任务', done: false, assignedThreadId: threadA };
  for (const items of [[], [{ ...task, done: true }], [{ ...task, assignedThreadId: threadB }], [{ ...task, text: '新任务内容' }], [{ ...task, assignedThreadId: null }]]) {
    const h = harness(); h.api.cacheGeneral(items);
    assert.equal(h.api.completeAssignedTask(task.id, threadA, task.text), false);
    assert.equal(h.api.completeAssignedTask(task.id, null, task.text), false);
    assert.equal(h.api.packet().actions.length, 0);
  }
});

test('project and claimable rows sort oldest first and show immutable added time across editing and acknowledgement', () => {
  const h = harness(), early = '2026-09-20T01:02:03.000Z', late = '2026-09-21T01:02:03.000Z';
  const items = [{ id: 'later', text: '较晚', done: false, createdAt: late }, { id: 'early', text: '最早', done: false, createdAt: early }];
  h.api.open({ key: 'p' }); h.api.accept({ projectKey: 'p', items, acknowledged: [] });
  const list = h.dialog.children[4], first = list.children[0];
  assert.deepEqual(list.children.map(row => row.children[1].value), ['最早', '较晚']);
  assert.equal(first.children.at(-1).attrs.datetime, early);
  assert.match(first.children.at(-1).textContent, /^2026-09-20/);
  first.children[1].value = '最早（编辑）'; first.children[1].listeners.change();
  const [action] = h.api.packet().actions, editedRow = list.children[0];
  assert.equal(action.createdAt, early);
  h.api.accept({ projectKey: 'p', items: [items[0], { ...items[1], text: action.text, updatedAt: late }], acknowledged: [action.requestId] });
  assert.equal(list.children[0], editedRow);
  h.api.cacheGeneral(items); h.api.openClaimableForCurrentThread(threadA);
  assert.deepEqual(list.children.map(row => row.children[0].value), ['最早', '较晚']);
  assert.equal(list.children[0].children.at(-1).attrs.datetime, early);
  assert.deepEqual(items.map(item => item.id), ['later', 'early']);
});

test('new task initial time survives pending storage reload and does not gain a new timestamp on edit', () => {
  const h = harness(); h.api.open({ key: 'p' }); h.api.accept({ projectKey: 'p', items: [], acknowledged: [] });
  const form = h.dialog.children[2]; form.children[0].value = '带时间的草稿'; form.listeners.submit({ preventDefault() {} });
  const createdAt = h.api.packet().actions[0].createdAt;
  assert.ok(Number.isFinite(Date.parse(createdAt)));
  const restored = harness(h.storage()); restored.api.open({ key: 'p' }); restored.api.accept({ projectKey: 'p', items: [], acknowledged: [] });
  const row = restored.dialog.children[4].children[0];
  assert.equal(row.children.at(-1).attrs.datetime, createdAt);
  row.children[1].value = '编辑后的草稿'; row.children[1].listeners.change();
  assert.equal(restored.api.packet().actions.at(-1).createdAt, createdAt);
});

test('legacy estimated and unknown times are explicit and assigned tasks retain the same date label', () => {
  const h = harness(), old = { id: 'old', text: '旧记录', done: false, updatedAt: '2026-09-20T01:02:03.000Z' };
  h.api.cacheGeneral([{ id: 'unknown', text: '缺时间', done: false }, old, { ...old, id: 'assigned', assignedThreadId: threadA }]); h.api.openGeneral();
  const rows = h.dialog.children[4].children;
  assert.equal(rows[0].children[1].value, old.text);
  assert.match(rows[0].children.at(-1).textContent, /^2026-09-20 /);
  assert.doesNotMatch(rows[0].children.at(-1).textContent, /估算/);
  assert.match(rows[0].children.at(-1).title, /最后保存时间估算/);
  assert.equal(rows[1].children.at(-1).textContent, '时间未记录');
  assert.equal(rows[2].children.at(-1).textContent, rows[0].children.at(-1).textContent);
});
