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
      busy: false, timeView: false, heldCount: 1, summarize: () => '',
      edit: () => calls.push('edit'), move: () => {}, resume: source => calls.push('resume:' + source),
      remove: () => calls.push('delete'), reassign: () => calls.push('reassign'), returnTask: () => calls.push('return')
    });
  assert.deepEqual(rows.map(row => row.kind), ['待办', '待办']);
  assert.deepEqual(rows.map(row => row.actions.map(action => action.label)), [
    ['编辑', '上移', '下移', '恢复', '删除'], ['恢复', '重派', '退回']
  ]);
  assert.equal(rows[0].time, held.heldAt);
  assert.equal(rows[1].time, Date.parse(assigned.createdAt));
  rows[1].actions[1].action();
  assert.deepEqual(calls, ['reassign']);
});

test('time view interleaves sources by original time, leaving unknown dates last', () => {
  const rows = orderNativeHeldTodoEntries([held], [assigned, { id: 'unknown', text: '未知' }], 'time');
  assert.deepEqual(rows.map(row => row.item.id), ['task', 'held', 'unknown']);
  assert.deepEqual(orderNativeHeldTodoEntries([held], [assigned], 'manual').map(row => row.item.id), ['held', 'task']);
});
