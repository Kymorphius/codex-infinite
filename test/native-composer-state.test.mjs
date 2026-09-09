import test from 'node:test';
import assert from 'node:assert/strict';
import { readNativeComposerState } from '../src/native-composer-state.mjs';
function documentFor(id, selected = false) {
  const portal = id ? { getAttribute: () => id } : null;
  const parent = { parentElement: null, querySelector: () => portal };
  const editor = { offsetWidth: 100, parentElement: parent, innerText: 'unsent draft' };
  return { querySelector: selector => selector.startsWith('[data-codex-composer') ? editor : selected };
}
test('composer identity works when original sidebar row is absent', () => {
  assert.deepEqual(readNativeComposerState(documentFor('target'), 'target'), { ready: true, draft: 'unsent draft' });
});
test('composer identity overrides a stale selected sidebar row', () => {
  assert.deepEqual(readNativeComposerState(documentFor('other', true), 'target'), { ready: false });
  assert.deepEqual(readNativeComposerState(documentFor(null, false), 'target'), { ready: false });
});
