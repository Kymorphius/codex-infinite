import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createAssignedChecklistState, resumeAssignedTask } from '../src/native-assigned-checklist-tasks.mjs';
import { appendNativeHeldTodoRows, orderNativeHeldTodoEntries } from '../src/native-held-todo-rows.mjs';
import { syncProjectChecklist } from '../src/project-checklist-sync.mjs';

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const a = { id: 'task-a', text: 'A 任务' }, b = { id: 'task-b', text: 'B 任务' };

test('assigned todo row exposes reassign between resume and return without sending', () => {
  const rows = [], called = [];
  appendNativeHeldTodoRows({ append: row => rows.push(row) }, orderNativeHeldTodoEntries([], [a], 'manual'),
    (status, text, buttons) => ({ status, text, buttons }), null, (label, action) => ({ label, action }),
    { busy: false, resume: () => called.push('resume'), reassign: (_, task) => called.push(['reassign', task.id]), returnTask: () => called.push('return') });
  assert.deepEqual(rows[0].buttons.map(button => button.label), ['编辑', '加入发送队列', '重派', '退回', '删除']);
  rows[0].buttons[2].action();
  assert.deepEqual(called, [['reassign', a.id]]);
});

test('assigned snapshots hide foreign tasks immediately, reject delayed and legacy publications, and skip identical writes', () => {
  let current = A;
  const state = createAssignedChecklistState(() => current);
  assert.equal(state.publish({ threadId: A, items: [a] }), true);
  assert.deepEqual(state.forThread(A), [a]);
  assert.equal(state.publish({ threadId: A, items: [a] }), false);
  current = B;
  assert.deepEqual(state.forThread(B), []);
  assert.deepEqual(state.forThread(A), []);
  assert.equal(state.owns(A, a), false);
  assert.equal(state.publish({ threadId: A, items: [a] }), false);
  assert.equal(state.publish([a]), false);
  assert.equal(state.publish({ threadId: B, items: [b] }), true);
  state.remove(A, b.id);
  assert.deepEqual(state.forThread(B), [b]);
  state.clear();
  assert.deepEqual(state.forThread(B), []);
  current = null;
  assert.equal(state.publish({ threadId: null, items: [a] }), false);
});

test('sync carries the read-time thread through navigation before the renderer receives it', async () => {
  let current = A, payload;
  const state = createAssignedChecklistState(() => current);
  const context = { window: {
    __codexControlConsoleSetAssignedChecklistTasks(value) { payload = value; state.publish(value); }
  } };
  const connection = { async evaluate(code) {
    if (code.includes('location.href')) return true;
    if (code === 'window.__cccProjectChecklist?.packet()') return {};
    if (code.startsWith('(function readNativeComposerThreadId')) return current;
    if (code.startsWith('window.__codexControlConsoleSetClaimableTaskCount')) {
      current = B; state.publish({ threadId: B, items: [b] });
    }
    if (code.startsWith('window.__codexControlConsoleSetAssignedChecklistTasks')) vm.runInNewContext(code, context);
  } };
  await syncProjectChecklist(connection, { async read() { return { items: [{ ...a, done: false, assignedThreadId: A }, { ...b, done: false, assignedThreadId: B }] }; } });
  assert.equal(payload.threadId, A);
  assert.equal(payload.items[0].id, a.id);
  assert.deepEqual(state.forThread(B), [b]);
});

function resumeHarness() {
  let current = A, busy = false, finishRequest, finishList;
  let markListStarted; const listStarted = new Promise(resolve => { markListStarted = resolve; });
  const state = createAssignedChecklistState(() => current), calls = [], complete = [], writes = [];
  state.publish({ threadId: A, items: [a] });
  const run = vm.runInNewContext(`(${resumeAssignedTask.toString()})`, {
    crypto: { randomUUID: () => 'request-id' },
    window: { __cccProjectChecklist: { completeAssignedTask: (...args) => complete.push(args) } }
  });
  const context = {
    threadId: A, isCurrent: () => current === A, ownsTask: task => state.owns(A, task),
    busy: () => busy, setBusy: value => { busy = value; },
    request: (method, params) => { calls.push({ method, params }); return new Promise(resolve => { finishRequest = resolve; }); },
    removeAssigned: id => state.remove(A, id),
    listQueue: () => new Promise(resolve => { finishList = resolve; markListStarted(); }),
    setServerItems: value => writes.push(value), setWarning: value => writes.push(value)
  };
  return { state, calls, complete, writes, listStarted, run: task => run(task, context), busy: () => busy,
    navigate: () => { current = B; state.clear(); state.publish({ threadId: B, items: [b] }); },
    resolveRequest: () => finishRequest(), resolveList: () => finishList([{ id: 'queue-a' }]) };
}

test('a detached old row cannot resume into the new thread or resume a changed task', async () => {
  const h = resumeHarness();
  h.state.publish({ threadId: A, items: [{ ...a, text: 'changed' }] });
  await h.run(a);
  h.navigate(); await h.run(a);
  assert.deepEqual(h.calls, []); assert.equal(h.busy(), false);
});

test('an in-flight resume keeps its original task and completion identity after navigation', async () => {
  const h = resumeHarness(), pending = h.run(a);
  assert.equal(h.calls[0].method, 'thread/queue/add');
  assert.equal(h.calls[0].params.threadId, A);
  assert.equal(h.calls[0].params.input[0].text, a.text);
  h.navigate(); h.resolveRequest(); await pending;
  assert.deepEqual(h.complete, [[a.id, A, a.text]]);
  assert.deepEqual(h.state.forThread(B), [b]);
  assert.deepEqual(h.writes, []); assert.equal(h.busy(), false);
});

test('a late queue listing from resume cannot overwrite the next thread', async () => {
  const h = resumeHarness(), pending = h.run(a);
  h.resolveRequest(); await h.listStarted;
  h.navigate(); h.resolveList(); await pending;
  assert.deepEqual(h.writes, []);
  assert.deepEqual(h.state.forThread(B), [b]);
});

test('a current resume completes and removes exactly its task and refreshes its own queue', async () => {
  const h = resumeHarness(), pending = h.run(a);
  h.resolveRequest(); await h.listStarted; h.resolveList(); await pending;
  assert.deepEqual(h.complete, [[a.id, A, a.text]]);
  assert.deepEqual(h.state.forThread(A), []);
  assert.deepEqual(h.writes, [[{ id: 'queue-a' }], '']);
  assert.equal(h.busy(), false);
});
