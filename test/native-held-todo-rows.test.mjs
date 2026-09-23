import test from 'node:test';
import assert from 'node:assert/strict';
import { appendNativeHeldTodoRows, orderNativeHeldTodoEntries } from '../src/native-held-todo-rows.mjs';

const held = { id: 'held', summary: '暂停内容', heldAt: Date.parse('2026-09-24T08:00:00Z') };
const assigned = { id: 'task', text: '领取内容', createdAt: '2026-09-23T08:00:00Z' };

test('all todo sources render through one row contract with one label and consistent action order', () => {
  const rows = [], calls = [];
  appendNativeHeldTodoRows({ append: row => rows.push(row) }, orderNativeHeldTodoEntries([held], [assigned], 'manual'),
    (kind, text, actions, time) => ({ kind, text, actions, time }), null,
    (label, action) => ({ label, action }), {
      busy: false, sorting: false, summarize: () => '',
      edit: () => calls.push('edit'), move: () => {}, resume: source => calls.push('resume:' + source),
      remove: () => calls.push('delete'), reassign: () => calls.push('reassign'), returnTask: () => calls.push('return')
    });
  assert.deepEqual(rows.map(row => row.kind), ['待办', '待办']);
  assert.deepEqual(rows.map(row => row.actions.map(action => action.label)), [
    ['编辑', '加入发送队列', '重派', '退回', '删除'], ['编辑', '加入发送队列', '重派', '退回', '删除']
  ]);
  assert.equal(rows.find(row => row.text === held.summary).time, held.heldAt);
  assert.equal(rows.find(row => row.text === assigned.text).time, Date.parse(assigned.createdAt));
  rows.find(row => row.text === assigned.text).actions[2].action();
  assert.deepEqual(calls, ['reassign']);
});

test('time view interleaves sources by original time, leaving unknown dates last', () => {
  const rows = orderNativeHeldTodoEntries([held], [assigned, { id: 'unknown', text: '未知' }], 'time');
  assert.deepEqual(rows.map(row => row.item.id), ['task', 'held', 'unknown']);
  assert.deepEqual(orderNativeHeldTodoEntries([held], [assigned], 'manage').map(row => row.item.id), ['task', 'held']);
});

test('dedicated sort view contains move controls and no task management buttons', () => {
  const rows = [];
  appendNativeHeldTodoRows({ append: row => rows.push(row) }, orderNativeHeldTodoEntries([held], [assigned], 'sort'),
    (kind, text, actions) => ({ kind, text, actions }), null, (label, action) => ({ label, action }),
    { busy: false, sorting: true, summarize: () => '', move: () => {} });
  for (const row of rows) assert.deepEqual(row.actions.map(action => action.label), ['上移', '下移']);
});
