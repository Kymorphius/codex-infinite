import test from 'node:test';
import assert from 'node:assert/strict';
import { installNativeRestartNeedsEntry } from '../src/native-restart-needs-panel.mjs';

class El {
  constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; this.attrs = {}; this.style = { setProperty() {}, cssText: '' }; this.hidden = false; this.ownText = ''; this.parentElement = null; this.className = ''; this.classes = []; this.dataset = {}; this.subs = {}; }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  getAttribute(key) { return this.attrs[key] ?? null; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  append(...nodes) { for (const node of nodes) { node.parentElement = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  insertBefore(node, ref) { node.remove(); const at = this.children.indexOf(ref); node.parentElement = this; this.children.splice(at < 0 ? this.children.length : at, 0, node); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((n) => n !== this); this.parentElement = null; }
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
  get nextElementSibling() { const list = this.parentElement?.children || []; return list[list.indexOf(this) + 1] || null; }
  get classList() { return { contains: (name) => this.classes.includes(name) }; }
  getBoundingClientRect() { return { left: 20, bottom: 60 }; }
  focus() {}
  querySelector(selector) { return selector === '[data-restart-needs-badge]' ? this.badge : null; }
  set innerHTML(_) { this.badge = new El('span'); this.badge.hidden = true; }
  set textContent(value) { this.ownText = String(value); this.children = []; }
  get textContent() { return this.ownText + this.children.map((child) => child.textContent).join(''); }
}

function setup(marks = []) {
  const listeners = new Set(), calls = [];
  const store = { list: () => marks, subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); }, refresh: async () => { calls.push('refresh'); }, set: async (mark, value) => { calls.push(['set', mark.id, value]); }, resolve: async (target, outcome) => { calls.push(['resolve', target, outcome]); } };
  const host = new El('div'); host.classes = ['ms-auto'];
  const row = new El('div'); row.append(new El('span'), host);
  const search = { parentElement: { parentElement: { parentElement: host } } };
  const events = {}, head = new El('head'), body = new El('body');
  const doc = {
    head, body,
    querySelector: (selector) => selector.startsWith('button') ? search : row.children.find((child) => child.attrs['data-codex-control-console-restart-needs'] !== undefined) || null,
    createElement: (tag) => new El(tag),
    addEventListener: (type, fn) => { events[type] = fn; }, removeEventListener() {}
  };
  const opened = [];
  globalThis.window = { __codexControlConsoleRestartMarks: store, __codexControlConsoleConversationTabs: { openMarked: (mark) => opened.push(mark.id) }, innerWidth: 1000 };
  return { doc, row, host, marks, listeners, store, calls, opened, body, events };
}

test('entry sits left of the sidebar header controls, needs the store, and installs once', () => {
  const f = setup();
  const entry = installNativeRestartNeedsEntry(f.doc);
  assert.equal(f.row.children.indexOf(entry) + 1, f.row.children.indexOf(f.host));
  assert.equal(installNativeRestartNeedsEntry(f.doc), entry);
  assert.equal(f.row.children.filter((child) => child.tag === 'button').length, 1);
  assert.equal(f.listeners.size, 1);
  assert.equal(entry.getAttribute('aria-label'), '需求 · 暂无需要重启或待验收的会话');
  const original = globalThis.window;
  globalThis.window = {};
  assert.equal(installNativeRestartNeedsEntry(f.doc), null);
  globalThis.window = original;
});

test('an older layout is removed and replaced even when its store is unchanged', () => {
  const f = setup();
  const oldEntry = installNativeRestartNeedsEntry(f.doc);
  const oldPanel = oldEntry.panel;
  oldEntry.cccRestartNeedsVersion = 'old-layout';
  const entry = installNativeRestartNeedsEntry(f.doc);
  assert.notEqual(entry, oldEntry);
  assert.equal(oldEntry.parentElement, null);
  assert.equal(oldPanel.parentElement, null);
  assert.equal(f.listeners.size, 1, 'only the new subscription remains');
  assert.equal(f.doc.head.children.length, 1, 'the old stylesheet is removed');
  assert.match(f.doc.head.children[0].textContent, /--color-surface-elevated/);
  assert.equal(installNativeRestartNeedsEntry(f.doc), entry);
});

test('badge counts marks; panel lists them, opens a conversation, unmarks, and shows an empty state', () => {
  const marks = [{ id: '00000000-0000-0000-0000-000000000001', provider: 'terminal', title: 'Claude 一', markedAt: '2026-09-29T10:00:00.000Z', status: 'restart' }];
  const f = setup(marks);
  const entry = installNativeRestartNeedsEntry(f.doc);
  assert.equal(entry.badge.hidden, false);
  assert.equal(entry.badge.textContent, '1');
  assert.match(entry.getAttribute('aria-label'), /1 个需要重启，0 个待验收/);
  entry.listeners.click({ preventDefault() {}, stopPropagation() {} });
  const panel = entry.panel;
  assert.equal(panel.hidden, false);
  assert.deepEqual(f.calls, ['refresh']);
  const item = panel.children[1]; assert.match(panel.children[0].textContent, /需要重启/);
  assert.equal(item.children[0].children[0].textContent, 'Claude 一');
  assert.match(item.children[0].children[1].textContent, /Claude CLI · 标记于/);
  item.children[0].listeners.click();
  assert.deepEqual(f.opened, [marks[0].id]);
  assert.equal(panel.hidden, true);
  entry.listeners.click({ preventDefault() {}, stopPropagation() {} });
  panel.children[1].children[1].listeners.click();
  assert.deepEqual(f.calls.at(-1), ['set', marks[0].id, false]);
  marks.length = 0;
  f.listeners.forEach((fn) => fn());
  assert.equal(entry.badge.hidden, true);
  assert.equal(panel.children[0].textContent, '暂无需要重启或待验收的会话');
  f.events.keydown({ key: 'Escape', preventDefault() {} });
  assert.equal(panel.hidden, true);
});

test('restarted marks move to a verify group with pass and fail actions and a blue badge', () => {
  const id = '00000000-0000-0000-0000-000000000002';
  const marks = [{ id, provider: 'local', title: '重启后的会话', markedAt: '2026-09-29T10:00:00.000Z', restartedAt: '2026-09-29T11:00:00.000Z', status: 'verify' }];
  const f = setup(marks);
  const entry = installNativeRestartNeedsEntry(f.doc);
  assert.equal(entry.badge.dataset.verifyOnly, 'true');
  assert.match(entry.getAttribute('aria-label'), /0 个需要重启，1 个待验收/);
  entry.listeners.click({ preventDefault() {}, stopPropagation() {} });
  const panel = entry.panel;
  assert.match(panel.children[0].textContent, /待验收/);
  const item = panel.children[1];
  assert.match(item.children[0].children[1].textContent, /已于 .* 重启/);
  assert.deepEqual(item.children.slice(1).map((child) => child.textContent), ['已验收', '未通过']);
  item.children[1].listeners.click();
  item.children[2].listeners.click();
  assert.deepEqual(f.calls.slice(-2), [['resolve', id, 'passed'], ['resolve', id, 'failed']]);
});
