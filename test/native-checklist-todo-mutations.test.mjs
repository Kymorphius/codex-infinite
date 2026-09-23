import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeChecklistTodoMutations } from '../src/native-checklist-todo-mutations.mjs';
import { replaceHeldEditableText } from '../src/held-queue-edit.mjs';

const THREAD = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const IMAGE = { type: 'heldImage', id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb:0' };
const task = { id: 'task-a', text: '原文', done: false, assignedThreadId: THREAD, input: [{ type: 'text', text: '原文' }, IMAGE] };

test('editing a claimed todo updates its text while retaining image input and task identity', () => {
  let current = THREAD;
  const actions = [], api = createNativeChecklistTodoMutations({ readThreadId: () => current, readItems: () => [task], replaceText: replaceHeldEditableText, enqueue: (type, item) => { actions.push({ type, item }); return true; } });
  assert.equal(api.edit(task.id, THREAD, task.text, '新文字'), true);
  assert.equal(actions[0].type, 'upsert');
  assert.equal(actions[0].item.id, task.id);
  assert.deepEqual(actions[0].item.input, [{ type: 'text', text: '新文字' }, IMAGE]);
  assert.equal(api.edit(task.id, THREAD, task.text, '   '), false);
  current = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  assert.equal(api.delete(task.id, THREAD, task.text), false);
  assert.equal(actions.length, 1);
});

test('deleting a claimed todo enqueues only its exact still-assigned task', () => {
  let currentTask = task;
  const actions = [], api = createNativeChecklistTodoMutations({ readThreadId: () => THREAD, readItems: () => [currentTask], replaceText: replaceHeldEditableText, enqueue: (type, item) => { actions.push({ type, item }); return true; } });
  assert.equal(api.delete(task.id, THREAD, 'stale text'), false);
  currentTask = { ...task, assignedThreadId: null };
  assert.equal(api.delete(task.id, THREAD, task.text), false);
  currentTask = task;
  assert.equal(api.delete(task.id, THREAD, task.text), true);
  assert.deepEqual(actions, [{ type: 'delete', item: task }]);
});
