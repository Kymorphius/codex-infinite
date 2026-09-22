import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildNativeProjectChecklistScript } from '../src/native-project-checklist.mjs';
import { returnAssignedTodo } from '../src/native-checklist-return.mjs';
import { appendAssignedChecklistTaskRows } from '../src/native-assigned-checklist-tasks.mjs';
import { ProjectChecklistStore } from '../src/project-checklist-store.mjs';
import { assignedChecklistTasksForThread } from '../src/project-checklist-assignment.mjs';

const generalKey = 'ccc:general-inbox:v1';
const threadA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const threadB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const task = { id: 'original-task', text: '1. 保留序号和原始内容\n2. 再次领取', done: false, assignedThreadId: threadA };
const plain = value => JSON.parse(JSON.stringify(value));

function harness({ saved = [], storageFails = false } = {}) {
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.listeners = {}; this.value = ''; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute(key, value) { this.attrs[key] = value; }
    addEventListener(key, fn) { this.listeners[key] = fn; }
    focus() {} remove() {} showModal() { this.open = true; } close() { this.open = false; }
  }
  let storage = JSON.stringify(saved), sequence = 0, currentThread = threadA;
  const document = {
    body: new Node('body'), head: new Node('head'), createElement: tag => new Node(tag),
    querySelectorAll: selector => selector === '[data-above-composer-conversation-id]' ? [{ getAttribute: () => currentThread }] : [],
    querySelector: () => null
  };
  const context = vm.createContext({
    document, window: { addEventListener() {}, removeEventListener() {} },
    crypto: { randomUUID: () => 'request-' + ++sequence },
    setTimeout: () => 1, clearTimeout() {},
    localStorage: {
      getItem: key => key === 'ccc.project-checklist.pending.v1' ? storage : null,
      setItem: (_, value) => { if (storageFails) throw new Error('quota exceeded'); storage = value; }
    }
  });
  vm.runInContext(buildNativeProjectChecklistScript(), context);
  const runReturn = vm.runInContext(`(${returnAssignedTodo.toString()})`, context);
  return {
    api: context.window.__cccProjectChecklist, dialog: document.body.children[0], runReturn,
    storage: () => JSON.parse(storage), switchThread: id => { currentThread = id; },
    unsetBridge: () => { delete context.window.__cccProjectChecklist; }
  };
}

function todoContext() {
  const state = { busy: false, warning: '', items: [{ id: task.id, text: task.text }], queueCalls: 0, removed: 0 };
  return {
    state, threadId: threadA, busy: () => state.busy, isCurrent: () => true,
    setBusy: value => { state.busy = value; }, setWarning: value => { state.warning = value; },
    removeAssigned: () => { state.removed++; state.items = []; },
    request: () => { state.queueCalls++; throw new Error('return must not send'); }
  };
}

test('assigned todo exposes return action with the original task and no management action', () => {
  const rows = [], returned = [], resumed = [];
  appendAssignedChecklistTaskRows({ append: row => rows.push(row) }, [task],
    (label, text, buttons) => ({ label, text, buttons }),
    (label, click, disabled) => ({ label, click, disabled }), false,
    item => returned.push(item), item => resumed.push(item));
  assert.deepEqual(rows[0].buttons.map(button => button.label), ['恢复', '退回']);
  rows[0].buttons[1].click();
  assert.equal(returned[0], task);
  assert.equal(resumed.length, 0);
});

test('return preserves original identity and waits for persistence acknowledgement without removing the todo', async () => {
  const h = harness(), ui = todoContext(); h.api.cacheGeneral([task]);
  let settled = false;
  const returning = h.runReturn(task, ui).then(() => { settled = true; });
  await Promise.resolve();
  const [action] = plain(h.api.packet().actions);
  assert.deepEqual(action, { ...task, projectKey: generalKey, type: 'upsert', assignedThreadId: null, requestId: 'request-1' });
  assert.deepEqual(h.storage(), [action]);
  assert.equal(settled, false); assert.equal(ui.state.busy, true);
  assert.equal(ui.state.items.length, 1); assert.equal(ui.state.removed, 0);
  assert.equal(ui.state.queueCalls, 0);
  await assert.rejects(h.api.returnAssignedTask(task.id, threadA, task.text), /任务状态已变化/);
  assert.equal(h.api.packet().actions.length, 1);
  h.api.accept({ projectKey: '', acknowledged: [], error: '' });
  await Promise.resolve(); assert.equal(settled, false);
  h.api.cacheGeneral([{ ...task, assignedThreadId: null }]);
  h.api.accept({ projectKey: '', acknowledged: [action.requestId], error: '' });
  await returning;
  assert.equal(ui.state.busy, false); assert.equal(ui.state.warning, '');
  assert.equal(ui.state.removed, 0, 'only the authoritative assigned snapshot may remove the row');
  assert.equal(ui.state.queueCalls, 0); assert.deepEqual(h.storage(), []);
});

test('stale owner, text, completion, removal and current-thread switch cannot return a task', async () => {
  for (const items of [[], [{ ...task, assignedThreadId: threadB }], [{ ...task, assignedThreadId: null }], [{ ...task, text: '修改后的内容' }], [{ ...task, done: true }]]) {
    const h = harness(); h.api.cacheGeneral(items);
    await assert.rejects(h.api.returnAssignedTask(task.id, threadA, task.text), /任务状态已变化/);
    assert.equal(h.api.packet().actions.length, 0);
  }
  const h = harness(); h.api.cacheGeneral([task]); h.switchThread(threadB);
  await assert.rejects(h.api.returnAssignedTask(task.id, threadA, task.text), /会话已切换/);
  assert.deepEqual(h.storage(), []);
});

test('return uses general tasks while another project contains a same-ID task', async () => {
  const projectTask = { ...task, text: '另一个项目里的任务', assignedThreadId: threadB };
  const h = harness(); h.api.cacheGeneral([task]); h.api.open({ key: 'another-project' });
  h.api.accept({ projectKey: 'another-project', items: [projectTask], acknowledged: [] });
  const returning = h.api.returnAssignedTask(task.id, threadA, task.text);
  const [action] = h.api.packet().actions;
  assert.equal(action.projectKey, generalKey); assert.equal(action.text, task.text);
  assert.equal(h.dialog.children[4].children[0].children[1].value, projectTask.text);
  h.api.accept({ projectKey: 'another-project', items: [projectTask], acknowledged: [action.requestId] });
  await returning;
  assert.equal(h.dialog.children[4].children[0].children[1].value, projectTask.text);
});

test('failed store persistence retains return for retry, keeps the todo and reports failure without queuing', async () => {
  const h = harness(), ui = todoContext(); h.api.cacheGeneral([task]);
  const returning = h.runReturn(task, ui);
  h.api.accept({ projectKey: '', acknowledged: [], error: '任务保存失败，草稿已保留' });
  await returning;
  assert.match(ui.state.warning, /退回保存失败/);
  assert.equal(ui.state.busy, false); assert.equal(ui.state.items.length, 1);
  assert.equal(ui.state.removed, 0); assert.equal(ui.state.queueCalls, 0);
  assert.equal(h.api.packet().actions.length, 1); assert.equal(h.storage().length, 1);
});

test('missing checklist bridge keeps the todo and reports that return is unavailable', async () => {
  const h = harness(), ui = todoContext(); h.unsetBridge();
  await h.runReturn(task, ui);
  assert.match(ui.state.warning, /任务清单尚未就绪/);
  assert.equal(ui.state.busy, false); assert.equal(ui.state.items.length, 1);
  assert.equal(ui.state.removed, 0); assert.equal(ui.state.queueCalls, 0);
  assert.deepEqual(h.storage(), []);
});

test('failed local draft save rejects return without adding an in-memory or persisted action', async () => {
  const h = harness({ storageFails: true }); h.api.cacheGeneral([task]);
  await assert.rejects(h.api.returnAssignedTask(task.id, threadA, task.text), /任务尚未保存到草稿/);
  assert.equal(h.api.packet().actions.length, 0); assert.deepEqual(h.storage(), []);
});

test('persisted return becomes claimable and can be reclaimed using the same task ID', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'checklist-return-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new ProjectChecklistStore(directory);
  await store.apply({ ...task, projectKey: generalKey, type: 'upsert', requestId: 'seed' });
  const h = harness(); h.api.cacheGeneral((await store.read(generalKey)).items);
  const returning = h.api.returnAssignedTask(task.id, threadA, task.text);
  const [action] = h.api.packet().actions;
  const acknowledged = [await store.apply(action)];
  const returned = (await new ProjectChecklistStore(directory).read(generalKey)).items;
  assert.equal(returned.length, 1);
  assert.deepEqual({ ...returned[0], updatedAt: undefined }, { ...task, assignedThreadId: null, updatedAt: undefined });
  assert.deepEqual(assignedChecklistTasksForThread(returned, threadA), []);
  h.api.cacheGeneral(returned); h.api.accept({ projectKey: '', acknowledged }); await returning;
  h.api.openClaimableForCurrentThread(threadB);
  const row = h.dialog.children[4].children[0];
  assert.equal(row.children[0].value, task.text); assert.equal(row.children[1].textContent, '领取');
  row.children[1].listeners.click();
  const [claim] = h.api.packet().actions;
  assert.equal(claim.id, task.id); assert.equal(claim.text, task.text);
  assert.equal(claim.done, false); assert.equal(claim.assignedThreadId, threadB);
  await store.apply(claim);
  const reclaimed = (await new ProjectChecklistStore(directory).read(generalKey)).items;
  assert.equal(reclaimed.length, 1);
  assert.deepEqual(assignedChecklistTasksForThread(reclaimed, threadB), [{ id: task.id, text: task.text }]);
  assert.deepEqual(assignedChecklistTasksForThread(reclaimed, threadA), []);
});
