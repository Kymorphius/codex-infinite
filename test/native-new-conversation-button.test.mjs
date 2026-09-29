import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createNativeTerminalActions } from '../src/native-terminal-actions.mjs';
import { installNativeNewConversationButton } from '../src/native-new-conversation-button.mjs';
import { buildNativeConversationTabsInjectionSource } from '../src/native-conversation-tabs.mjs';
import { NATIVE_RECENT_CONVERSATION_STYLE } from '../src/native-recent-conversations.mjs';

const id = '00000000-0000-0000-0000-000000000001';
const projectRef = { source: 'codex', key: 'native-key', id: 'project-a', hostId: 'local' };
const claude = { id, title: 'Claude', kind: 'claude', cwd: '/work', projectRef };

function actionsFor(request, opened = [], accepted = []) {
  return createNativeTerminalActions({ documentRef: {}, windowRef: { __codexControlConsoleOpenTerminalConversation: value => opened.push(value) }, request, accept: value => accepted.push(value), readModel: () => ({}) });
}

test('fresh creates a Claude conversation in the same directory and project, accepts and opens it', async () => {
  const calls = [], opened = [], accepted = [], created = { id: 'new', provider: 'terminal' };
  const actions = actionsFor(async (operation, input) => { calls.push({ operation, input }); return { conversation: created }; }, opened, accepted);
  assert.deepEqual(await actions.fresh(claude), { ok: true });
  assert.deepEqual(calls, [{ operation: 'create', input: { cwd: '/work', kind: 'claude', projectRef } }]);
  assert.deepEqual([opened[0], accepted[0]], [created, created]);
  await actions.fresh({ ...claude, projectRef: undefined });
  assert.equal(calls[1].input.projectRef, null, 'an unlinked conversation stays unlinked');
});

test('fresh reports failures without creating anything and refuses non-Claude records', async () => {
  const opened = [];
  assert.deepEqual(await actionsFor(async () => { throw Error('目录无效'); }, opened).fresh(claude), { ok: false, message: '目录无效' });
  let called = false;
  assert.equal((await actionsFor(async () => { called = true; return {}; }, opened).fresh({ ...claude, kind: 'shell' })).ok, false);
  assert.equal(called, false); assert.deepEqual(opened, []);
});

class El {
  constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; this.attrs = {}; this.style = {}; this.dataset = {}; this.disabled = false; this.hidden = false; this.title = ''; this.className = ''; this.ownText = ''; }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  getAttribute(key) { return this.attrs[key] ?? null; }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  focus() { this.focused = true; }
  set textContent(value) { this.ownText = String(value); }
  get textContent() { return this.ownText; }
}

function setup(tab, { records = [], projectOfTask = null, projectOfDirectory = null, row = null } = {}) {
  const created = [], body = new El('body'), root = new El('nav'), docListeners = {};
  const calls = { fresh: [], create: [], claudeCreate: [] };
  const documentRef = { body, createElement: tag => { const node = new El(tag); created.push(node); return node; }, createElementNS: (_, tag) => new El(tag), querySelector: () => row,
    addEventListener: (type, fn) => { docListeners[type] = fn; }, removeEventListener: type => { delete docListeners[type]; } };
  globalThis.window = {
    __cccTerminalConversations: { records: () => records, fresh: async record => { calls.fresh.push(record.id); return { ok: true }; }, create: async (...args) => { calls.claudeCreate.push(args); return true; } },
    __codexControlConsoleProjectSearch: { projectOfTask: () => projectOfTask, projectOfDirectory: directory => { calls.directory = directory; return projectOfDirectory; } },
    __cccProjectSearchActions: { create: async value => { calls.create.push(value); return true; } }
  };
  let active = tab;
  const button = installNativeNewConversationButton({ documentRef, root, activeTab: () => active });
  const host = root.children[0], trigger = host.children[0], menu = host.children[1];
  const choose = async target => { await menu.children.find(item => item.dataset.newTarget === target).listeners.click({ preventDefault() {}, stopPropagation() {} }); };
  const open = () => trigger.listeners.click({ preventDefault() {}, stopPropagation() {} });
  return { button, trigger, menu, calls, choose, open, body, root, docListeners, setActive(value) { active = value; button.update(); } };
}

test('the new button is enabled only for Codex and Claude conversations and offers both engines', () => {
  const f = setup({ kind: 'terminal', id, engine: 'claude' });
  assert.equal(f.root.children.length, 1);
  assert.equal(f.trigger.children.at(-1).textContent, '新建');
  assert.equal(f.trigger.disabled, false); assert.equal(f.menu.hidden, true);
  assert.deepEqual(f.menu.children.map(item => item.children[0].children[0].textContent), ['GPT 会话', 'Claude CLI 会话']);
  f.open(); assert.equal(f.menu.hidden, false); assert.equal(f.trigger.attrs['aria-expanded'], 'true');
  f.setActive({ kind: 'local', id }); assert.equal(f.trigger.disabled, false);
  for (const tab of [{ kind: 'terminal', id, engine: 'shell' }, { kind: 'chatgpt', id }, { kind: 'remote', id }, { kind: 'console' }, null, { kind: 'local', id: 'nope' }]) {
    f.setActive(tab); assert.equal(f.trigger.disabled, true, JSON.stringify(tab)); assert.equal(f.menu.hidden, true, 'a disabled button closes its menu');
  }
  f.button.destroy(); assert.equal(f.root.children.length, 0); assert.deepEqual(f.docListeners, {});
});

test('the menu closes on outside pointer, Escape and after choosing', async () => {
  const f = setup({ kind: 'terminal', id, engine: 'claude' }, { records: [claude] });
  f.open(); f.docListeners.pointerdown({ target: f.body }); assert.equal(f.menu.hidden, true);
  f.open(); f.docListeners.pointerdown({ target: f.menu.children[0] }); assert.equal(f.menu.hidden, false, 'inside clicks keep it open');
  f.docListeners.keydown({ key: 'Escape', preventDefault() {} }); assert.equal(f.menu.hidden, true); assert.equal(f.trigger.focused, true);
  f.open(); await f.choose('claude'); assert.equal(f.menu.hidden, true);
});

test('from a Claude conversation: Claude starts a sibling in the same directory and project', async () => {
  const f = setup({ kind: 'terminal', id, engine: 'claude' }, { records: [claude] });
  await f.choose('claude');
  assert.deepEqual(f.calls.fresh, [id]); assert.deepEqual(f.calls.create, []);
});

test('from a Claude conversation: GPT opens the native new chat of the project holding its directory', async () => {
  const catalog = { id: 'catalog', checklistKey: 'sidebar', sourceDirectories: ['/work'] };
  const f = setup({ kind: 'terminal', id, engine: 'claude' }, { records: [claude], projectOfDirectory: catalog });
  await f.choose('codex');
  assert.equal(f.calls.directory, '/work'); assert.deepEqual(f.calls.create, [catalog]); assert.deepEqual(f.calls.fresh, []);
  const lost = setup({ kind: 'terminal', id, engine: 'claude' }, { records: [claude] });
  await lost.choose('codex');
  assert.deepEqual(lost.calls.create, []); assert.match(lost.body.children[0].textContent, /找不到当前会话所属项目/);
});

test('from a Codex conversation: GPT uses the catalog project, else the sidebar project row', async () => {
  const catalog = { id: 'catalog', checklistKey: 'sidebar' };
  const first = setup({ kind: 'local', id }, { projectOfTask: catalog });
  await first.choose('codex');
  assert.deepEqual(first.calls.create, [catalog]);
  const list = { getAttribute: () => 'local-project-9' };
  const second = setup({ kind: 'local', id }, { row: { closest: () => list } });
  await second.choose('codex');
  assert.deepEqual(second.calls.create, [{ id: 'project-9' }]);
});

test('from a Codex conversation: Claude is created in the project directory only when it is unambiguous', async () => {
  const single = { id: 'catalog', sourceDirectories: ['/work'] };
  const f = setup({ kind: 'local', id }, { projectOfTask: single });
  await f.choose('claude');
  assert.deepEqual(f.calls.claudeCreate, [[single, '/work', 'claude']]);
  const many = setup({ kind: 'local', id }, { projectOfTask: { id: 'm', sourceDirectories: ['/a', '/b'] } });
  await many.choose('claude');
  assert.deepEqual(many.calls.claudeCreate, []); assert.match(many.body.children[0].textContent, /多个目录/);
  const none = setup({ kind: 'local', id }, { projectOfTask: { id: 'n' } });
  await none.choose('claude');
  assert.deepEqual(none.calls.claudeCreate, []); assert.match(none.body.children[0].textContent, /找不到项目目录/);
});

test('unresolvable projects and missing Claude records explain themselves and create nothing', async () => {
  const lost = setup({ kind: 'local', id });
  await lost.choose('codex');
  assert.deepEqual(lost.calls.create, []); assert.match(lost.body.children[0].textContent, /找不到当前会话所属项目/);
  const missing = setup({ kind: 'terminal', id, engine: 'claude' }, { records: [] });
  await missing.choose('claude');
  assert.deepEqual(missing.calls.fresh, []); assert.match(missing.body.children[0].textContent, /找不到当前 Claude 会话/);
});

test('the injected tabs source ships the button and its style', () => {
  const source = buildNativeConversationTabsInjectionSource();
  assert.match(source, /function installNativeNewConversationButton/);
  assert.match(source, /installNativeNewConversationButton\(\{ documentRef: document, root: shortcutRoot, activeTab \}\)/);
  assert.match(NATIVE_RECENT_CONVERSATION_STYLE, /\.ccc-native-recent-trigger:disabled/);
  assert.doesNotThrow(() => new vm.Script(`(function(){${source}})`));
});
