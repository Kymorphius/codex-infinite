import test from 'node:test';
import assert from 'node:assert/strict';
import { readNativeTodoOrder, writeNativeTodoOrder, moveNativeTodoEntry, bootstrapNativeTodoOrder } from '../src/native-held-todo-order.mjs';
import { orderNativeHeldTodoEntries } from '../src/native-held-todo-rows.mjs';

test('sort view persists per-thread manual order without changing task records', () => {
  const values = new Map(), storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  const thread = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', key = 'todo.order';
  const tasks = [{ id: 'a', text: 'A', createdAt: '2026-09-23T00:00:00Z' }, { id: 'b', text: 'B', createdAt: '2026-09-24T00:00:00Z' }];
  const entries = orderNativeHeldTodoEntries([], tasks, 'sort');
  const moved = moveNativeTodoEntry(entries, 'b', -1);
  writeNativeTodoOrder(storage, key, thread, moved);
  assert.deepEqual(readNativeTodoOrder(storage, key, thread), ['b', 'a']);
  assert.deepEqual(orderNativeHeldTodoEntries([], tasks, 'manage', moved).map(entry => entry.item.id), ['b', 'a']);
  assert.deepEqual(orderNativeHeldTodoEntries([], tasks, 'time', moved).map(entry => entry.item.id), ['a', 'b']);
  assert.equal(readNativeTodoOrder(storage, key, 'other').length, 0);
  assert.equal(tasks[0].id, 'a');
});

test('old manually reordered held items keep their relative order when the shared order store starts empty', () => {
  const values = new Map(), storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  const held = [{ id: 'later', heldAt: 20 }, { id: 'earlier', heldAt: 10 }];
  const ids = bootstrapNativeTodoOrder(storage, 'todo.order', 'thread', held, [{ id: 'assigned' }]);
  assert.deepEqual(ids, ['later', 'earlier', 'assigned']);
  assert.deepEqual(readNativeTodoOrder(storage, 'todo.order', 'thread'), ids);
});
