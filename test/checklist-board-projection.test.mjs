import test from 'node:test';
import assert from 'node:assert/strict';
import { GENERAL_CHECKLIST_KEY, projectChecklistBoardItems } from '../src/checklist-board-projection.mjs';

test('board checklist projection retains task identity and status without input or receipts', () => {
  assert.equal(GENERAL_CHECKLIST_KEY, 'ccc:general-inbox:v1');
  const items = projectChecklistBoardItems([{ id: 'task-1', text: '检查发布', createdAt: '2026-09-23T00:00:00Z', done: false,
    assignedThreadId: null, input: [{ type: 'image', data: 'secret' }], requestId: 'private' }]);
  assert.deepEqual(items, [{ id: 'task-1', text: '检查发布', createdAt: '2026-09-23T00:00:00Z', done: false, assignedThreadId: null }]);
});
