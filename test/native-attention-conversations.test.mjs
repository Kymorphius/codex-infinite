import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildNativeAttentionConversationsInjectionScript, buildNativeAttentionConversationsSnapshotScript } from '../src/native-attention-conversations.mjs';

class Node {
  constructor(tag = 'div') { this.tag = tag; this.children = []; this.attrs = {}; this.style = {}; this.listeners = {}; this.className = ''; }
  append(...nodes) { for (const node of nodes) { this.children.push(node); node.parentElement = this; } }
  insertBefore(node, before) { this.children.splice(this.children.indexOf(before), 0, node); node.parentElement = this; }
  remove() { if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null; }
  getAttribute(key) { return this.attrs[key] || null; }
  setAttribute(key, value) { this.attrs[key] = value; }
  addEventListener(key, fn) { this.listeners[key] = fn; }
  querySelector() { return null; }
}
function all(node) { return [node, ...node.children.flatMap(all)]; }
function harness() {
  const parent = new Node(); const wrapper = new Node(); const native = new Node('section'); const nativeRow = new Node();
  const nativeCreate = new Node('button'); let creations = 0; nativeCreate.click = () => { creations += 1; };
  const nativeHeading = new Node(); nativeHeading.className = 'native-heading';
  nativeRow.className = 'native-project'; native.append(nativeRow); wrapper.append(native); parent.append(wrapper);
  native.querySelector = selector => selector.includes('nav-section-title') ? nativeHeading : selector.includes('project-create') ? nativeCreate : null;
  const document = { documentElement: parent, querySelectorAll: () => all(parent).filter(node => 'data-codex-control-console-attention-conversations' in node.attrs), createElementNS: (ns, tag) => new Node(tag), createElement: tag => new Node(tag), querySelector: selector => selector.includes('project-create') ? nativeCreate : selector.includes('Projects') ? native : nativeRow };
  const messages = []; const storage = new Map(); let now = Date.now(); let timer;
  const context = vm.createContext({ document, window: { postMessage: message => messages.push(message) },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    MutationObserver: class { observe() {} disconnect() {} }, requestAnimationFrame: callback => callback(),
    setInterval: callback => { timer = callback; return 1; }, clearInterval() {}, Date: { now: () => now, parse: Date.parse } });
  const run = () => vm.runInContext(buildNativeAttentionConversationsInjectionScript(), context);
  const set = items => vm.runInContext(buildNativeAttentionConversationsSnapshotScript(items), context);
  const find = attribute => all(parent).find(node => node.attrs[attribute]);
  return { parent, wrapper, nativeRow, creations: () => creations, run, set, find, messages, context, expire: () => { now += 10_000; timer(); } };
}
const id = '01a04cd6-8d30-78f1-b2a7-f760d148f744';
const item = { id, title: '<会话>', projectLabel: '项目', section: 'review', updatedAt: '2026-09-01T00:00:00Z' };
test('every automatic alias restores the workspace and opens a tab before routing without a native task row', () => {
  for (const section of ['review', 'active', 'codex']) {
    const h = harness(); const calls = [];
    h.nativeRow.remove();
    h.context.window.__codexControlConsoleClose = () => calls.push(['restore']);
    h.context.window.__codexControlConsoleConversationTabs = { openLocal: tab => calls.push(['tab', tab.id, tab.title]) };
    h.context.window.postMessage = message => calls.push(['route', message.path]);
    h.run(); h.set({ items: [{ ...item, section }], stale: false });
    h.find('data-attention-thread-id').listeners.click();
    assert.deepEqual(calls, [['restore'], ['tab', id, item.title], ['route', '/local/' + id]], section);
    h.set({ items: [], stale: false });
    assert.equal(calls.length, 3, 'removing the read alias must not close its tab');
  }
});
test('three native-style automatic sections preserve original rows and route to the same conversation', () => {
  const h = harness(); h.wrapper.children[0].className = 'relative px-row-x'; h.run();
  h.set({ items: [item], stale: false });
  assert.equal(h.parent.children.length, 5);
  assert.equal(h.wrapper.children[0].children[0], h.nativeRow);
  const row = h.find('data-attention-thread-id');
  assert.equal(row.children[0].textContent, '<会话>'); assert.equal(row.children[1].textContent, '项目');
  assert.equal(row.style.paddingInlineStart, 'var(--padding-row-cell-x,var(--padding-row-x,8px))');
  row.listeners.click(); assert.equal(h.messages[0].path, '/local/' + id);
  const roots = h.parent.children.filter(x => x.attrs['data-codex-control-console-attention-conversations']);
  assert.deepEqual(roots.map(x => x.style.order), ['5', '6', '7', '8']);
  assert.ok(roots.every(x => x.children[0].className === 'relative px-row-x'));
  h.run(); h.set({ items: [item], stale: false }); assert.equal(h.parent.children.length, 5);
});
test('read completion removes the alias, active update moves it, collapse and drop blocking stay independent', () => {
  const h = harness(); h.run(); h.set({ items: [item], stale: false });
  h.set({ items: [{ ...item, section: 'active' }], stale: false });
  const active = h.parent.children.find(x => x.attrs['data-codex-control-console-attention-conversations'] === 'active');
  assert.ok(all(active).some(x => x.attrs['data-attention-thread-id'] === id));
  let prevented = false; let stopped = false; const dataTransfer = {};
  active.listeners.drop({ preventDefault() { prevented = true; }, stopPropagation() { stopped = true; }, dataTransfer });
  assert.ok(prevented && stopped); assert.equal(dataTransfer.dropEffect, 'none');
  all(active).find(x => x.attrs['data-attention-toggle']).listeners.click();
  assert.equal(h.find('data-attention-thread-id'), undefined);
  h.set({ items: [], stale: false }); assert.equal(h.find('data-attention-thread-id'), undefined);
  assert.equal(h.wrapper.children[0].children[0], h.nativeRow);
});
test('unavailable status is explicit and is not rendered as a known-empty list', () => {
  const h = harness(); h.run();
  assert.ok(all(h.parent).some(x => x.textContent === '状态暂未更新'));
  assert.ok(!all(h.parent).some(x => x.textContent === '暂无进行中的会话'));
});

test('Codex aliases render only in the Codex section and retain native navigation', () => {
  const h = harness(); h.run(); h.set({ items: [{ ...item, section: 'codex' }], stale: false });
  const roots = h.parent.children.filter(x => x.attrs['data-codex-control-console-attention-conversations']);
  assert.deepEqual(roots.map(root => all(root).filter(x => x.attrs['data-attention-thread-id']).length), [0, 0, 1, 0]);
  h.find('data-attention-thread-id').listeners.click(); assert.equal(h.messages[0].path, '/local/' + id);
});

test('viewed review alias disappears immediately, history survives reinjection, later completion returns', () => {
  const h = harness(); h.run(); h.set({ items: [item], stale: false });
  h.context.window.__codexControlConsoleConversationTabs = { openLocal: task => h.context.window.__codexControlConsoleAttentionConversations.view(task) };
  h.find('data-attention-thread-id').listeners.click();
  const rows = key => all(h.parent.children.find(x => x.attrs['data-codex-control-console-attention-conversations'] === key)).filter(x => x.attrs['data-attention-thread-id']);
  assert.equal(rows('review').length, 0); assert.equal(rows('history').length, 1);
  h.set({ items: [item], stale: false }); assert.equal(rows('review').length, 0);
  h.context.window.__codexControlConsoleAttentionConversations.version = 'old'; h.run();
  h.set({ items: [item], stale: false }); assert.equal(rows('review').length, 0); assert.equal(rows('history').length, 1);
  h.set({ items: [{ ...item, updatedAt: '2099-01-01T00:00:00Z' }], stale: false });
  assert.equal(rows('review').length, 1); assert.equal(rows('history').length, 1);
});
