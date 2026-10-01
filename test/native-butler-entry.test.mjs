import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildNativeButlerEntryScript, parseButlerLink } from '../src/native-butler-entry.mjs';
import { buildNativeOpenLocalProjectInjectionScript } from '../src/native-open-local-project.mjs';
import { buildNativeGeneralChecklistScript } from '../src/native-general-checklist.mjs';
import { BUTLER_ENGINE } from '../src/butler-prompt.mjs';

const CWD = '/Users/me/.codex-control-console/butler';
const A = '019a0000-0000-7000-8000-00000000000a', B = '019a0000-0000-7000-8000-00000000000b', C = '019a0000-0000-7000-8000-00000000000c';
const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));

function matches(el, selector) {
  return selector.split(',').some(part => {
    const m = /^([a-z]*)((?:\[[^\]]+\])*)$/i.exec(part.trim());
    if (!m) throw new Error('unsupported selector ' + part);
    if (m[1] && el.tagName !== m[1].toUpperCase()) return false;
    for (const [, name, op, value] of m[2].matchAll(/\[([\w-]+)(?:(\^?=)"([^"]*)")?\]/g)) {
      const actual = el.getAttribute(name);
      if (actual == null || op === '=' && actual !== value || op === '^=' && !actual.startsWith(value)) return false;
    }
    return true;
  });
}
class El {
  constructor(tag = 'div', text = '') { this.tagName = tag.toUpperCase(); this.localName = tag; this.attrs = {}; this.children = []; this.parentElement = null; this.style = {}; this.className = ''; this.textContent = text; this.events = {}; this.title = ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); } getAttribute(k) { return this.attrs[k] ?? null; } removeAttribute(k) { delete this.attrs[k]; }
  set innerHTML(v) { this.html = v; }
  append(...nodes) { for (const n of nodes) { n.remove(); this.children.push(n); n.parentElement = this; } }
  insertBefore(n, before) { n.remove(); const i = before ? this.children.indexOf(before) : -1; this.children.splice(i < 0 ? this.children.length : i, 0, n); n.parentElement = this; }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(n => n !== this); this.parentElement = null; }
  addEventListener(k, fn) { this.events[k] = fn; } click() { this.events.click?.({ preventDefault() {}, stopPropagation() {} }); }
  get nextSibling() { const s = this.parentElement?.children || []; return s[s.indexOf(this) + 1] || null; }
  get previousElementSibling() { const s = this.parentElement?.children || []; return s[s.indexOf(this) - 1] || null; }
  get isConnected() { let n = this; while (n.parentElement) n = n.parentElement; return n.isRoot === true; }
  getBoundingClientRect() { return { width: 20, height: 20 }; }
  closest(selector) { for (let n = this; n; n = n.parentElement) if (!n.isRoot && matches(n, selector)) return n; return null; }
  querySelectorAll(selector) { const out = []; const walk = n => { for (const c of n.children) { if (matches(c, selector)) out.push(c); walk(c); } }; walk(this); return out; }
  querySelector(selector) { return selector === '.truncate' ? new El('span') : this.querySelectorAll(selector)[0] || null; }
}

function env({ stored = null, handler = () => ({}), routerReady = true, blocks = false, bridge = true } = {}) {
  const root = new El('html'); root.isRoot = true;
  const head = new El('head'), body = new El('body'); root.append(head, body);
  const parent = new El('nav'); body.append(parent);
  const newChat = new El('button', '新聊天'); newChat.className = 'native-top-action';
  const addProject = new El('button', '添加新项目'); parent.append(newChat); body.append(addProject);
  const observers = [], listeners = {}, messages = new Set(), calls = [], timers = [], saved = new Map();
  if (stored) saved.set('codex-control-console.butler.v1', JSON.stringify(stored));
  const document = { documentElement: root, head, body, createElement: tag => new El(tag),
    querySelector: s => root.querySelector(s), querySelectorAll: s => root.querySelectorAll(s),
    addEventListener: (k, fn) => { (listeners[k] ||= []).push(fn); }, removeEventListener: (k, fn) => { listeners[k] = (listeners[k] || []).filter(f => f !== fn); } };
  const opened = { tabs: [], native: [], chatgpt: [], terminal: [], posted: [], preview: [] };
  const window = {
    addEventListener: (k, fn) => k === 'message' && messages.add(fn), removeEventListener: (k, fn) => messages.delete(fn),
    postMessage: data => opened.posted.push(data),
    __cccClaudeRouterReady: () => routerReady, __cccClaudePreviewBlocks: () => blocks,
    __cccClaudePreviewSet: async (...args) => { opened.preview.push(args); },
    __codexControlConsoleConversationTabs: { openLocal: tab => opened.tabs.push(plain(tab)), openChatgpt: tab => opened.chatgpt.push(plain(tab)) },
    __codexControlConsoleOpenNativeThread: async id => { opened.native.push(id); return { applied: true }; },
    __codexControlConsoleOpenTerminalConversation: async ref => { opened.terminal.push(plain(ref)); return true; },
    __cccProjectChecklist: { openGeneral() {} },
  };
  if (bridge) window.electronBridge = { sendMessageFromView: async message => {
    calls.push(plain([message.request.method, message.request.params]));
    const result = await handler(message.request.method, message.request.params);
    setImmediate(() => { for (const fn of [...messages]) fn({ data: { type: 'mcp-response', hostId: 'local', message: { id: message.request.id, result } } }); });
  } };
  const context = vm.createContext({ window, document, navigator: { platform: 'MacIntel' },
    localStorage: { getItem: k => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, v) },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    requestAnimationFrame: fn => fn(), setTimeout: (fn, ms) => { timers.push([fn, ms]); return timers.length; }, clearTimeout() {},
    MutationObserver: class { constructor(fn) { this.fn = fn; } observe() { observers.push(this); } disconnect() { observers.splice(observers.indexOf(this), 1); } } });
  const run = script => vm.runInContext(script, context);
  const flush = () => { for (const o of [...observers]) o.fn([]); };
  const fire = (type, target) => { const event = { type, target, prevented: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } }; for (const fn of listeners[type] || []) fn(event); return event; };
  const stored_ = () => JSON.parse(saved.get('codex-control-console.butler.v1') || 'null');
  return { root, body, parent, newChat, window, document, run, flush, fire, calls, opened, timers, stored: stored_, butler: buildNativeButlerEntryScript({ cwd: CWD }) };
}
const labels = parent => parent.children.map(n => n.getAttribute('data-codex-control-console-butler-entry') != null ? '管家'
  : n.getAttribute('data-codex-control-console-open-local-project') != null ? '打开本地项目'
    : n.getAttribute('data-ccc-general-checklist-entry') != null ? '任务清单' : n.textContent);
const entry = e => e.document.querySelector('[data-codex-control-console-butler-entry]');

test('parseButlerLink accepts only exact local, chatgpt and terminal fragments', () => {
  assert.deepEqual(parseButlerLink('#ccc-open/local/' + A), { kind: 'local', id: A });
  assert.deepEqual(parseButlerLink('#ccc-open/chatgpt/' + A.toUpperCase()), { kind: 'chatgpt', id: A });
  assert.deepEqual(parseButlerLink('#ccc-open/terminal/' + A), { kind: 'terminal', id: A });
  for (const href of ['#ccc-open/local/' + A + '?prompt=x', '#ccc-open/local/' + A + '/', '#ccc-open/local/' + A + ' ', 'ccc-open/local/' + A,
    '#ccc-open/LOCAL/' + A, '#ccc-open/remote/' + A, 'codex://threads/' + A, 'https://x/#ccc-open/local/' + A, '#ccc-open/local/' + A.slice(1), null, 42])
    assert.equal(parseButlerLink(href), null, String(href));
});

test('entry sits between 新聊天 and 打开本地项目 in either install order and survives remount', () => {
  for (const order of [['butler', 'open'], ['open', 'butler']]) {
    const e = env();
    const scripts = { butler: e.butler, open: buildNativeOpenLocalProjectInjectionScript() };
    for (const name of order) e.run(scripts[name]);
    e.run(buildNativeGeneralChecklistScript()); e.flush(); e.flush();
    assert.deepEqual(labels(e.parent), ['新聊天', '管家', '打开本地项目', '任务清单'], order.join());
    const button = entry(e);
    assert.equal(button.className, 'native-top-action'); assert.equal(button.getAttribute('aria-label'), '管家 · 管理全部会话');
    assert.match(button.html, /<svg viewBox="0 0 20 20"[^>]+stroke="currentColor" stroke-width="1.7"/); assert.match(button.html, />管家</);
    e.run(e.butler); e.run(e.butler);
    assert.equal(e.document.querySelectorAll('[data-codex-control-console-butler-entry]').length, 1);
    assert.equal(entry(e), button);
    const fresh = new El('nav'), chat = new El('button', '新聊天'); chat.className = 'native-top-action';
    e.parent.remove(); e.body.append(fresh); fresh.append(chat); e.flush(); e.flush();
    assert.deepEqual(labels(fresh), ['新聊天', '管家', '打开本地项目', '任务清单']);
  }
});

test('butler and checklist settle next to 新聊天 when 打开本地项目 is absent', () => {
  const e = env(); e.run(e.butler); e.run(buildNativeGeneralChecklistScript()); e.flush();
  const moves = []; const insert = e.parent.insertBefore.bind(e.parent);
  e.parent.insertBefore = (n, before) => { moves.push(n.textContent); insert(n, before); };
  e.flush(); e.flush(); e.flush();
  assert.deepEqual(labels(e.parent), ['新聊天', '管家', '任务清单']); assert.deepEqual(moves, []);
});

test('reinstall with a new cwd replaces the entry and its listeners', () => {
  const e = env(); e.run(e.butler); e.flush();
  const first = entry(e);
  e.run(buildNativeButlerEntryScript({ cwd: CWD + '2' })); e.flush();
  assert.notEqual(entry(e), first); assert.equal(first.parentElement, null);
  assert.equal(e.document.querySelectorAll('[data-codex-control-console-butler-entry]').length, 1);
});

test('stored butler thread is reused without list, create or model switch', async () => {
  const e = env({ stored: { threadId: A }, blocks: true, handler: m => m === 'thread/read' ? { thread: { id: A, cwd: CWD + '/', name: '管家' } } : assert.fail(m) });
  e.run(e.butler); e.flush();
  assert.equal(await e.window.__cccButler.open(), A);
  assert.deepEqual(e.calls, [['thread/read', { threadId: A, includeTurns: false }]]);
  assert.deepEqual(e.opened.tabs, [{ id: A, title: '管家' }]); assert.deepEqual(e.opened.native, [A]);
  assert.deepEqual(e.opened.preview, []);
  assert.match(e.root.querySelector('style').textContent, new RegExp('\\[data-app-action-sidebar-thread-id="local:' + A + '"\\]\\{display:none'));
  assert.equal(entry(e).getAttribute('data-state'), null);
});

test('an archived stored butler thread is not reused', async () => {
  const e = env({ stored: { threadId: A }, handler: m => m === 'thread/read' ? { thread: { id: A, cwd: CWD, path: '/h/.codex/archived_sessions/2026/a.jsonl' } }
    : m === 'thread/list' ? { data: [{ id: B, cwd: CWD, updatedAt: 1 }] } : assert.fail(m) });
  e.run(e.butler);
  assert.equal(await e.window.__cccButler.open(), B);
});

test('lost or mismatched cache falls back to the newest thread listed by cwd', async () => {
  const e = env({ stored: { threadId: A }, handler: m => m === 'thread/read' ? { thread: { id: A, cwd: '/elsewhere' } }
    : m === 'thread/list' ? { data: [{ id: B, cwd: CWD, updatedAt: 10 }, { id: C, cwd: CWD, updatedAt: 50 }, { id: A, cwd: '/x', updatedAt: 99 }] } : assert.fail(m) });
  e.run(e.butler);
  assert.equal(await e.window.__cccButler.open(), C);
  assert.deepEqual(e.calls[1], ['thread/list', { cwd: CWD, archived: false, limit: 10, sortKey: 'updated_at' }]);
  assert.deepEqual(e.stored(), { threadId: C }); assert.equal(e.window.__cccButler.id(), C);
  assert.deepEqual(e.opened.preview, [[C, 'auto', false, 'opus']]);
});

test('first click creates, names and routes the butler through Claude Router; concurrent clicks share it', async () => {
  const e = env({ handler: m => ({ 'thread/list': { data: [] }, 'thread/start': { thread: { id: B, cwd: CWD } }, 'thread/name/set': {} })[m] });
  e.run(e.butler); e.flush();
  const first = e.window.__cccButler.open(), second = e.window.__cccButler.open();
  entry(e).click();
  assert.equal(first, second);
  assert.equal(await first, B); await tick();
  assert.deepEqual(e.calls.map(([m]) => m), ['thread/list', 'thread/start', 'thread/name/set']);
  assert.deepEqual(e.calls[1][1], { cwd: CWD, ephemeral: false, sandbox: 'read-only', approvalPolicy: 'never' });
  assert.deepEqual(e.calls[2][1], { threadId: B, name: '管家' });
  assert.deepEqual(e.opened.preview, [[B, BUTLER_ENGINE.effort, BUTLER_ENGINE.nativeTools, BUTLER_ENGINE.family]]);
  assert.deepEqual(e.stored(), { threadId: B }); assert.deepEqual(e.opened.native, [B]);
});

test('without Router the thread still opens on GPT and the tooltip says so', async () => {
  const e = env({ routerReady: false, handler: m => ({ 'thread/list': { data: [] }, 'thread/start': { thread: { id: B, cwd: CWD } }, 'thread/name/set': {} })[m] });
  e.run(e.butler);
  assert.equal(await e.window.__cccButler.open(), B);
  assert.deepEqual(e.opened.preview, []); assert.deepEqual(e.opened.native, [B]);
  assert.equal(entry(e).getAttribute('data-state'), 'note'); assert.match(entry(e).title, /Router 未就绪/);
});

test('failures show a short error state and never throw', async () => {
  const e = env({ bridge: false });
  e.run(e.butler);
  assert.equal(await e.window.__cccButler.open(), null);
  assert.equal(entry(e).getAttribute('data-state'), 'error'); assert.match(entry(e).title, /^管家打开失败：原生会话桥接尚未就绪/);
  const [reset, ms] = e.timers.at(-1); assert.equal(ms, 4000); reset();
  assert.equal(entry(e).getAttribute('data-state'), null); assert.equal(entry(e).title, '管家 · 管理全部会话');
  assert.deepEqual(e.opened.native, []);
});

test('links are intercepted only inside the butler timeline', () => {
  const e = env({ stored: { threadId: A } });
  const timeline = new El('div'); timeline.setAttribute('data-app-action-timeline-scroll', '');
  const composer = new El('div'); composer.setAttribute('data-above-composer-conversation-id', A);
  const link = (href, text) => { const a = new El('a'); a.setAttribute('href', href); const span = new El('span', text); a.textContent = text; a.append(span); timeline.append(a); return span; };
  e.body.append(timeline, composer); e.run(e.butler);
  const local = link('#ccc-open/local/' + B, ' Zotero 修复 '), chat = link('#ccc-open/chatgpt/' + C, '网页聊天'), term = link('#ccc-open/terminal/' + C, '终端');
  const query = link('#ccc-open/local/' + B + '?prompt=x', '坏链接');
  let event = e.fire('click', local);
  assert.equal(event.prevented, true); assert.equal(event.stopped, true);
  assert.deepEqual(e.opened.tabs, [{ id: B, title: 'Zotero 修复' }]);
  e.fire('auxclick', chat); assert.deepEqual(e.opened.chatgpt, [{ id: C, title: '网页聊天' }]);
  e.fire('click', term); assert.deepEqual(e.opened.terminal, [{ provider: 'terminal', conversationId: C }]);
  assert.equal(e.fire('click', query).prevented, false);
  const outside = new El('a'); outside.setAttribute('href', '#ccc-open/local/' + B); e.body.append(outside);
  assert.equal(e.fire('click', outside).prevented, false);
  const code = new El('code', 'ccc-open/local/' + C); timeline.append(code); e.flush();
  assert.equal(code.getAttribute('data-ccc-butler-link'), '#ccc-open/local/' + C); assert.equal(code.style.cursor, 'pointer');
  assert.equal(e.fire('click', code).prevented, true); assert.deepEqual(e.opened.tabs.at(-1), { id: C, title: 'ccc-open/local/' + C });
  composer.setAttribute('data-above-composer-conversation-id', B);
  assert.equal(e.fire('click', local).prevented, false);
  assert.equal(e.opened.tabs.length, 2);
});
