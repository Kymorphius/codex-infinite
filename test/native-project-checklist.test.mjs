import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildNativeProjectChecklistScript } from '../src/native-project-checklist.mjs';
import { readNativeChecklistHeldTodos } from '../src/native-checklist-held-todos.mjs';
function harness(saved = '[]') {
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.listeners = {}; this.value = ''; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute(k, v) { this.attrs[k] = v; }
    addEventListener(k, fn) { this.listeners[k] = fn; }
    focus() {} remove() {} showModal() { this.open = true; } close() { this.open = false; }
  }
  let storage = saved, id = 0;
  const document = { body: new Node('body'), head: new Node('head'), createElement: tag => new Node(tag) };
  const context = vm.createContext({ document, window: { addEventListener() {}, removeEventListener() {} }, crypto: { randomUUID: () => 'id-' + ++id }, localStorage: { getItem: () => storage, setItem: (_, v) => { storage = v; } } });
  vm.runInContext(buildNativeProjectChecklistScript(), context);
  return { api: context.window.__cccProjectChecklist, dialog: document.body.children[0], storage: () => storage };
}
test('native checklist adds, edits, completes and deletes while acknowledging without replacing in-progress input', () => {
  const h = harness(); h.api.open({ key: 'p', name: '项目' });
  const form = h.dialog.children[2], input = form.children[0], list = h.dialog.children[4];
  assert.equal(input.disabled, true);
  h.api.accept({ projectKey: 'p', items: [], acknowledged: [] });
  input.value = '做一件事'; form.listeners.submit({ preventDefault() {} });
  let packet = h.api.packet(); assert.equal(packet.actions.length, 1);
  const action = packet.actions[0], row = list.children[0]; row.children[1].value = '尚未失去焦点的编辑';
  h.api.accept({ projectKey: 'p', items: [{ id: action.id, text: action.text, done: false, updatedAt: 'now' }], acknowledged: [action.requestId] });
  assert.equal(list.children[0], row); assert.equal(row.children[1].value, '尚未失去焦点的编辑');
  row.children[1].listeners.change();
  assert.equal(h.api.packet().actions[0].text, '尚未失去焦点的编辑');
  list.children[0].children[0].checked = true; list.children[0].children[0].listeners.change();
  assert.equal(h.api.packet().actions.at(-1).done, true);
  list.children[0].children[2].listeners.click(); assert.equal(h.api.packet().actions.at(-1).type, 'delete');
  assert.equal(JSON.parse(h.storage()).length, 3);
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
});
