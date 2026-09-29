import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, id, record } from '../test-support/native-recent-menu-fixture.mjs';
import { nativeRecentRestartEligible } from '../src/native-recent-restart-mark.mjs';

function fakeStore(marks = []) {
  const listeners = new Set(), toggled = [];
  return {
    marks, toggled, listeners,
    get: (target) => marks.find((mark) => mark.id === target) || null,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    refresh: async () => null,
    toggle: async (recordToToggle) => { toggled.push(recordToToggle); }
  };
}

test('only native Codex and Claude CLI conversations get a restart toggle', () => {
  assert.equal(nativeRecentRestartEligible({ kind: 'local', id: id(1) }), true);
  assert.equal(nativeRecentRestartEligible({ kind: 'terminal', engine: 'claude', id: id(1) }), true);
  assert.equal(nativeRecentRestartEligible({ kind: 'terminal', engine: 'shell', id: id(1) }), false);
  for (const kind of ['chatgpt', 'remote']) assert.equal(nativeRecentRestartEligible({ kind, id: id(1) }), false);
  assert.equal(nativeRecentRestartEligible({ kind: 'local', id: 'not-a-thread' }), false);
});

test('recent rows show the marked state, toggle through the store, and follow store changes', () => {
  const f = fixture({ items: [record(2)] });
  const store = fakeStore();
  f.window.__codexControlConsoleRestartMarks = store;
  f.trigger.dispatch('click');
  const row = f.menu.children[0], button = row.children[1];
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  assert.match(button.title, /标记为需要重启/);
  let prevented = 0;
  button.dispatch('click', { preventDefault() { prevented++; }, stopPropagation() { prevented++; } });
  assert.equal(prevented, 2, 'the click never reaches the row select handler');
  assert.deepEqual(store.toggled.map((item) => [item.id, item.provider, item.title]), [[id(2), 'local', '会话 2']]);
  assert.equal(f.selected.length, 0);
  store.marks.push({ id: id(2), provider: 'local', title: '会话 2', markedAt: '2026-09-29T10:00:00.000Z', status: 'restart' });
  f.trigger.dispatch('click'); f.trigger.dispatch('click');
  assert.equal(f.menu.children[0].children[1].getAttribute('aria-pressed'), 'true');
  assert.match(f.menu.children[0].children[1].title, /需要重启 · 标记于/);
});

test('a restarted mark shows as verify and its button carries the verify state', () => {
  const f = fixture({ items: [record(2)] });
  const store = fakeStore([{ id: id(2), provider: 'local', title: '会话 2', markedAt: '2026-09-29T10:00:00.000Z', restartedAt: '2026-09-29T11:00:00.000Z', status: 'verify' }]);
  f.window.__codexControlConsoleRestartMarks = store;
  f.trigger.dispatch('click');
  const button = f.menu.children[0].children[1];
  assert.equal(button.dataset.status, 'verify');
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  assert.match(button.title, /待验收 · 已于 .* 重启（点击标为已验收）/);
});
