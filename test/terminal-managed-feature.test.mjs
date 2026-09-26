import test from 'node:test';
import assert from 'node:assert/strict';
import { createManagedTerminalFeature } from '../public/features/terminal/managed.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
const record = (id, fields = {}) => ({ id, provider: 'terminal', deviceId: 'local', title: id, kind: 'shell', cwd: '/project', runtimeSessionId: null, status: 'stopped', ...fields });
function harness(t, target = 'first') {
  const elements = new Map(), requests = [], views = [], originals = new Map();
  class Element {
    constructor() { this.classes = new Set(); this.classList = { add: name => this.classes.add(name), toggle: (name, value) => value ? this.classes.add(name) : this.classes.delete(name), remove: name => this.classes.delete(name), contains: name => this.classes.has(name) }; this.listeners = new Map(); this.children = []; this.style = {}; this.dataset = {}; this.value = ''; this.scrollHeight = 58; }
    querySelector(selector) { return $(selector); } querySelectorAll() { return []; }
    replaceChildren(...children) { this.children = children; } append(...children) { this.children.push(...children); }
    addEventListener(type, callback) { this.listeners.set(type, callback); }
    setAttribute(name, value) { this[name] = value; } focus() {} close() {} showModal() {}
    click() { this.listeners.get('click')?.({}); }
  }
  const $ = selector => { if (!elements.has(selector)) elements.set(selector, new Element()); return elements.get(selector); };
  const install = (name, value) => { originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, writable: true, value }); };
  const location = new URL(`http://127.0.0.1:47831/?module=terminal&view=conversation&conversationId=${target}`);
  const listeners = new Map(), messages = [], parent = {};
  const windowRef = { parent, addEventListener: (type, listener) => listeners.set(type, listener), removeEventListener: type => listeners.delete(type) };
  parent.postMessage = value => messages.push(value); install('window', windowRef);
  install('location', location); install('history', { replaceState: (_, __, next) => { location.href = new URL(next, location).href; } });
  install('document', { body: new Element(), createElement: () => new Element() });
  install('Terminal', class {}); install('FitAddon', { FitAddon: class {} });
  const request = (url, options) => {
    if (!options) return Promise.resolve({ version: 1, localDeviceId: 'local', devices: [] });
    return new Promise((resolve, reject) => requests.push({ url, body: options.body, resolve, reject }));
  };
  const feature = createManagedTerminalFeature({ state: { module: 'terminal' }, $, showToast() {}, request,
    createView(session) { const view = { session, active: false, disposed: false, snapshot: () => ({ session, connection: 'connected', canInput: view.active && session.status === 'running' }), activate: () => { view.active = true; }, deactivate: () => { view.active = false; }, dispose: () => { view.disposed = true; }, pasteText: async () => ({ ok: true }) }; views.push(view); return view; } });
  t.after(() => { feature.dispose(); for (const [name, descriptor] of originals) descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]; });
  async function resolveOpen(conversation) {
    requests.at(-1).resolve({ conversations: [conversation], deviceId: 'local', defaultCwd: '/home' }); await settle();
    assert.match(requests.at(-1).url, /\/open$/u); requests.at(-1).resolve({ conversation }); await settle();
  }
  return { feature, $, requests, views, location, resolveOpen, listeners, parent, messages };
}

test('stable query identity opens without spawning, uses raw runtime id and keeps exited output restartable', async t => {
  const h = harness(t); h.feature.bind();
  await h.resolveOpen(record('first', { status: 'exited', runtimeSessionId: 'pty-1', runtimeSummary: { cols: 142, rows: 51, exitCode: 2, status: 'exited' } }));
  assert.equal(h.views[0].session.id, 'pty-1'); assert.equal(h.views[0].session.cols, 142);
  assert.equal(h.location.searchParams.get('conversationId'), 'first');
  assert.equal(h.$('[data-terminal-start]').classList.contains('hidden'), false);
  assert.equal(h.$('[data-testid="terminal-viewport"]').classList.contains('hidden'), false);
  assert.ok(h.requests.every(value => !value.url.endsWith('/start')));
  assert.equal(document.body.classList.contains('terminal-conversation-view'), true);
});

test('latest reference wins a stale list and never opens the previous target', async t => {
  const h = harness(t); h.feature.bind();
  h.feature.openReference({ provider: 'terminal', conversationId: 'second', deviceId: 'local' });
  h.requests[0].resolve({ conversations: [record('first')], deviceId: 'local' }); await settle();
  assert.equal(h.requests.length, 2);
  await h.resolveOpen(record('second'));
  assert.deepEqual(h.requests.filter(value => value.url.endsWith('/open')).map(value => value.body.id), ['second']);
  assert.equal(h.location.searchParams.get('conversationId'), 'second');
  assert.equal(h.$('[data-testid="terminal-session-title"]').textContent, 'second');
});

test('a completed start cannot steal a newly selected conversation', async t => {
  const h = harness(t); h.feature.bind(); await h.resolveOpen(record('first'));
  h.$('[data-terminal-start]').click(); const start = h.requests.at(-1);
  assert.ok(start.url.endsWith('/start'));
  h.feature.openReference({ provider: 'terminal', conversationId: 'second' });
  const nextList = h.requests.at(-1);
  start.resolve({ conversation: record('first', { status: 'running', runtimeSessionId: 'old-pty' }) }); await settle();
  assert.equal(h.views.length, 0);
  nextList.resolve({ conversations: [record('second')], deviceId: 'local' }); await settle();
  h.requests.at(-1).resolve({ conversation: record('second', { status: 'running', runtimeSessionId: 'new-pty' }) }); await settle();
  assert.deepEqual(h.views.map(value => value.session.id), ['new-pty']);
  assert.equal(h.location.searchParams.get('conversationId'), 'second');
});

test('missing explicit stable id survives refresh without selecting a different conversation', async t => {
  const h = harness(t, 'missing'); h.feature.bind();
  h.requests[0].resolve({ conversations: [record('other')], deviceId: 'local' }); await settle();
  h.requests.at(-1).reject(Error('会话不存在')); await settle();
  assert.equal(h.location.searchParams.get('conversationId'), 'missing');
  assert.match(h.$('[data-testid="terminal-error"]').textContent, /不存在/u);
  assert.equal(h.views.length, 0);
  void h.feature.load();
  assert.ok(h.requests.at(-1).url.endsWith('/list'));
  h.requests.at(-1).resolve({ conversations: [record('other')], deviceId: 'local' }); await settle();
  assert.equal(h.requests.at(-1).body.id, 'missing');
  h.requests.at(-1).reject(Error('会话不存在')); await settle();
});

test('native metadata updates refresh the active view and restart affordance only from exact parent', async t => {
  const h = harness(t); h.feature.bind();
  await h.resolveOpen(record('first', { status: 'running', runtimeSessionId: 'pty-1' }));
  const update = { type: 'codex-control-console-terminal-record-changed', conversation: record('first', { title: '改名', revision: 2 }) };
  h.listeners.get('message')({ origin: 'https://wrong.test', source: h.parent, data: update });
  assert.equal(h.$('[data-testid="terminal-session-title"]').textContent, 'first');
  const count = h.messages.length;
  h.listeners.get('message')({ origin: 'app://-', source: h.parent, data: update });
  assert.equal(h.messages.length, count, 'parent-origin update must not echo');
  assert.equal(h.$('[data-testid="terminal-session-title"]').textContent, '改名');
  assert.equal(h.$('[data-terminal-start]').classList.contains('hidden'), false);
  assert.equal(h.views[0].disposed, true);
  assert.equal(h.feature.acceptUpdate(record('another')), false);
});
