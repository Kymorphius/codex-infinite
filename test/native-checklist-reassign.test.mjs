import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeChecklistReassignController, openNativeChecklistReassignPicker } from '../src/native-checklist-board-jump.mjs';

const THREAD = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const task = { id: 'task-a', text: 'A 任务', assignedThreadId: THREAD, done: false };

test('reassign picker targets the exact assigned row', () => {
  let clicked = 0, scrolled = 0;
  const target = { dataset: { checklistTaskId: task.id }, querySelectorAll: () => [{ textContent: '改派会话', disabled: false, click: () => { clicked++; } }], scrollIntoView: () => { scrolled++; } };
  const other = { dataset: { checklistTaskId: 'other' }, querySelectorAll: () => [{ textContent: '改派会话', click: () => { throw Error('wrong row'); } }] };
  const list = { querySelectorAll: () => [other, target] };
  assert.equal(openNativeChecklistReassignPicker(list, task.id), true);
  assert.equal(clicked, 1); assert.equal(scrolled, 1);
  assert.equal(openNativeChecklistReassignPicker(list, 'missing'), false);
});

test('reassign waits for checklist load and rejects changed task identity', () => {
  let current = THREAD, loaded = false, opened = 0, rendered = 0, clicked = 0, warning = '';
  let items = [task];
  const row = { dataset: { checklistTaskId: task.id }, querySelectorAll: () => [{ textContent: '改派会话', click: () => { clicked++; } }], scrollIntoView() {} };
  const controller = createNativeChecklistReassignController({
    readThreadId: () => current, readItems: () => items, openGeneral: () => { opened++; },
    getLoaded: () => loaded, isOpen: () => true, list: { querySelectorAll: () => [row] },
    warn: message => { warning = message; }, render: () => { rendered++; }
  });
  assert.equal(controller.open(task.id, THREAD, task.text), true);
  assert.equal(opened, 1); assert.equal(clicked, 0);
  loaded = true; controller.afterRender();
  assert.equal(clicked, 1);
  assert.equal(controller.open(task.id, THREAD, task.text), true);
  items = [{ ...task, text: 'changed' }]; controller.afterRender();
  assert.equal(clicked, 1); assert.match(warning, /归属已变化/);
  current = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  assert.equal(controller.open(task.id, THREAD, task.text), false);
  assert.equal(rendered, 1);
});
