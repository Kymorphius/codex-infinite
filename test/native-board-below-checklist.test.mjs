import test from 'node:test';
import assert from 'node:assert/strict';
import { placeNativeBoardBelowChecklist } from '../src/native-board-below-checklist.mjs';

function parent() {
  return {
    children: [],
    insertBefore(node, before) {
      node.parentElement?.remove(node);
      const index = before ? this.children.indexOf(before) : -1;
      this.children.splice(index < 0 ? this.children.length : index, 0, node);
      node.parentElement = this;
    },
    remove(node) { this.children = this.children.filter(value => value !== node); node.parentElement = null; }
  };
}

function node(name) {
  return { name, parentElement: null, get nextSibling() { const items = this.parentElement?.children || []; return items[items.indexOf(this) + 1] || null; },
    get previousElementSibling() { const items = this.parentElement?.children || []; return items[items.indexOf(this) - 1] || null; } };
}

test('board button moves below checklist once and follows a remounted sidebar without duplication', () => {
  const old = parent(), current = parent(), board = node('看板'), checklist = node('任务清单'), other = node('其他');
  old.insertBefore(board, null); current.insertBefore(checklist, null); current.insertBefore(other, null);
  assert.equal(placeNativeBoardBelowChecklist(board, checklist), true);
  assert.deepEqual(current.children.map(item => item.name), ['任务清单', '看板', '其他']);
  assert.equal(old.children.length, 0);
  assert.equal(placeNativeBoardBelowChecklist(board, checklist), false);
  const remounted = parent(), nextChecklist = node('任务清单'); remounted.insertBefore(nextChecklist, null);
  assert.equal(placeNativeBoardBelowChecklist(board, nextChecklist), true);
  assert.deepEqual(remounted.children.map(item => item.name), ['任务清单', '看板']);
  assert.equal(current.children.filter(item => item === board).length, 0);
});

test('board keeps its existing location until the checklist entry exists', () => {
  const host = parent(), board = node('看板'); host.insertBefore(board, null);
  assert.equal(placeNativeBoardBelowChecklist(board, null), false);
  assert.deepEqual(host.children, [board]);
});
