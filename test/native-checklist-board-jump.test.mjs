import test from 'node:test';
import assert from 'node:assert/strict';
import { focusNativeChecklistTask, openNativeChecklistTask } from '../src/native-checklist-board-jump.mjs';

test('board jump focuses the exact task identity, not a matching text', () => {
  let scrolled = 0, focused = 0;
  const rows = [
    { dataset: { checklistTaskId: 'first' } },
    { dataset: { checklistTaskId: 'second' }, scrollIntoView() { scrolled++; }, querySelector() { return { focus() { focused++; } }; } }
  ];
  const list = { querySelectorAll() { return rows; } };
  assert.equal(focusNativeChecklistTask(list, 'second'), true);
  assert.equal(scrolled, 1);
  assert.equal(focused, 1);
  assert.equal(focusNativeChecklistTask(list, 'missing'), false);
});

test('board jump rejects invalid ids and unavailable checklist before hiding dashboard', () => {
  const previous = globalThis.window;
  let restored = 0, opened = null;
  try {
    globalThis.window = { __cccProjectChecklist: { openGeneral(id) { opened = id; } } };
    assert.equal(openNativeChecklistTask('../bad', () => restored++), false);
    assert.equal(restored, 0);
    assert.equal(openNativeChecklistTask('task-1', () => restored++), true);
    assert.equal(restored, 1);
    assert.equal(opened, 'task-1');
    globalThis.window = {};
    assert.equal(openNativeChecklistTask('task-2', () => restored++), false);
    assert.equal(restored, 1);
  } finally { globalThis.window = previous; }
});
