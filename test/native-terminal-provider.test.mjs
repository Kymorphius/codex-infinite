import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installNativeTerminalProvider } from '../src/native-terminal-provider.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
function harness(prepareConnection = () => false) {
  const messages = [], renders = [], timers = new Map(), listeners = new Map();
  let nextId = 0, nextTimer = 0;
  const frame = { contentWindow: { postMessage: (message, origin) => messages.push({ message, origin }) }, setAttribute() {}, remove() {} };
  const window = { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name),
    __codexControlConsoleConversationTabs: { syncTerminal() {}, active: () => ({ kind: 'local' }) } };
  const context = vm.createContext({ window, URL, crypto: { randomUUID: () => `request-${++nextId}` },
    document: { createElement: () => frame, body: { append() {} }, documentElement: {}, querySelector: () => null },
    MutationObserver: class { observe() {} disconnect() {} },
    setTimeout: fn => { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout: id => timers.delete(id),
    setInterval: () => 10, clearInterval() {}
  });
  context.readModel = () => ({}); context.makeSidebar = () => ({ render: values => renders.push(values), destroy() {} });
  context.makeActions = () => ({ menu() {}, create() {}, notice() {}, destroy() {} });
  context.prepareConnection = prepareConnection;
  vm.runInContext(`globalThis.provider=(${installNativeTerminalProvider.toString()})('http://127.0.0.1:47831',readModel,makeSidebar,makeActions,prepareConnection)`, context);
  const channel = new URL(frame.src).searchParams.get('channel');
  function receive(data, overrides = {}) { listeners.get('message')?.({ origin: 'http://127.0.0.1:47831', source: frame.contentWindow, data: { channel, ...data }, ...overrides }); }
  return { context, provider: context.provider, frame, messages, renders, timers, receive };
}

test('native terminal bridge accepts only its exact loopback origin, source and channel', async () => {
  const h = harness();
  h.receive({ type: 'codex-terminal-ready' }, { origin: 'http://localhost:47831' });
  h.receive({ type: 'codex-terminal-ready' }, { source: {} });
  h.receive({ type: 'codex-terminal-ready', channel: 'wrong' });
  assert.equal(h.messages.length, 0);
  h.receive({ type: 'codex-terminal-ready' });
  assert.equal(h.messages[0].message.operation, 'list');
  assert.equal(h.messages[0].origin, 'http://127.0.0.1:47831');
  const id = h.messages[0].message.id;
  h.receive({ type: 'codex-terminal-response', id, result: { conversations: [{ id: 'conversation', provider: 'terminal' }] } }, { source: {} });
  await tick(); assert.equal(h.renders.length, 0);
  h.receive({ type: 'codex-terminal-response', id, result: { conversations: [{ id: 'conversation', provider: 'terminal' }] } });
  await tick(); assert.equal(h.renders.length, 1); assert.equal(h.renders[0][0].id, 'conversation'); h.provider.dispose();
});

test('provider bridge disposal rejects outstanding operations and cannot accept delayed replies', async () => {
  const h = harness(); h.receive({ type: 'codex-terminal-ready' });
  const initial = h.messages[0].message;
  h.receive({ type: 'codex-terminal-response', id: initial.id, result: { conversations: [] } }); await tick();
  const request = h.provider.request('update', { id: 'conversation', expectedRevision: 1, title: 'New title' });
  const rejection = assert.rejects(request, /重新连接/); h.provider.dispose(); await rejection;
  assert.equal(h.timers.size, 0); assert.equal(h.messages.at(-1).message.operation, 'update');
  await assert.rejects(h.provider.request('start', { id: 'conversation' }), /正在连接/);
});

test('first explicit action requests CSP preparation without automatically retrying a mutation', async () => {
  let preparations = 0; const h = harness(() => { preparations++; return true; });
  assert.equal(preparations, 0, 'boot never requests a document reload');
  await assert.rejects(h.provider.request('create', { cwd: '/work', kind: 'claude' }), /页面恢复后再次操作/);
  assert.equal(preparations, 1); assert.equal(h.messages.length, 0);
  h.receive({ type: 'codex-terminal-ready' });
  assert.deepEqual(h.messages.map(value => value.message.operation), ['list']);
  h.provider.dispose();
});

test('context-menu and refreshed metadata changes notify once and echoed iframe updates do not loop', async () => {
  const h = harness(), changes = [];
  h.context.window.__codexControlConsoleTerminalChanged = record => changes.push(record);
  const record = { id: 'conversation', deviceId: 'mac', provider: 'terminal', title: 'Claude', revision: 1, status: 'running', runtimeSessionId: 'pty-a' };
  h.receive({ type: 'codex-terminal-ready' });
  h.receive({ type: 'codex-terminal-response', id: h.messages.at(-1).message.id, result: { conversations: [record] } }); await tick();
  const stopped = { ...record, status: 'stopped', runtimeSessionId: null };
  h.provider.accept(stopped); assert.equal(changes.length, 2); assert.equal(changes.at(-1).status, 'stopped');
  h.provider.accept({ runtimeSessionId: null, ...stopped }); assert.equal(changes.length, 2, 'echo with reordered properties is unchanged');
  h.provider.accept({ ...stopped, title: 'Renamed', revision: 2 }); assert.equal(changes.length, 3);
  h.provider.accept(record); assert.equal(changes.length, 3, 'older metadata cannot undo a confirmed rename');
  const refresh = h.provider.refresh(), resumed = { ...stopped, title: 'Renamed', revision: 2, status: 'running', runtimeSessionId: 'pty-b' };
  h.receive({ type: 'codex-terminal-response', id: h.messages.at(-1).message.id, result: { conversations: [resumed] } }); await refresh;
  assert.equal(changes.length, 4); assert.equal(changes.at(-1).runtimeSessionId, 'pty-b');
  h.provider.accept(resumed); assert.equal(changes.length, 4); h.provider.dispose();
});

test('a delayed list cannot replace a context-menu mutation accepted while the list was pending', async () => {
  const h = harness(), changes = []; h.context.window.__codexControlConsoleTerminalChanged = record => changes.push(record);
  const record = { id: 'conversation', provider: 'terminal', deviceId: 'mac', revision: 1, status: 'running', runtimeSessionId: 'pty-a' };
  h.receive({ type: 'codex-terminal-ready' }); const pendingList = h.messages.at(-1).message;
  h.provider.accept({ ...record, status: 'stopped', runtimeSessionId: null });
  h.receive({ type: 'codex-terminal-response', id: pendingList.id, result: { conversations: [record] } }); await tick();
  assert.equal(changes.length, 1); assert.equal(changes[0].status, 'stopped'); assert.equal(h.renders.at(-1)[0].status, 'stopped');
  h.provider.dispose();
});
