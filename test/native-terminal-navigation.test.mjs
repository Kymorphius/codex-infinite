import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildNativeProviderNavigationSource, nativeTerminalHost, nativeNavigationControl } from '../src/native-terminal-navigation.mjs';
import { terminalConversationTab, createNativeTerminalTabController } from '../src/native-terminal-tabs.mjs';
import { normalizeNativeConversationTab, NativeConversationTabState } from '../src/native-conversation-tab-state.mjs';
import { createNativeConversationTabNormalizer } from '../src/native-conversation-tab-titles.mjs';
import { buildEmbeddedFrameRecoveryInjectionSource } from '../src/embedded-frame-recovery.mjs';

const id = '019fffff-aaaa-7000-bbbb-123456789abc';
const other = '019fffff-aaaa-7000-bbbb-123456789abd';
const record = { id, provider: 'terminal', deviceId: 'mac-node', kind: 'claude', title: 'Claude 项目会话', cwd: '/work', revision: 1 };
const deferred = () => { let resolve; const promise = new Promise(value => { resolve = value; }); return { promise, resolve }; };

test('terminal tabs retain distinct device and provider identity through both normalizers', () => {
  const input = terminalConversationTab(record), tab = normalizeNativeConversationTab(input);
  const normalize = createNativeConversationTabNormalizer({ getItem: () => null }, value => String(value || ''), /^[0-9a-f-]{36}$/i);
  assert.equal(tab.key, `terminal:mac-node/${id}`);
  assert.deepEqual(normalize(input), { kind: 'terminal', id, deviceId: 'mac-node', title: record.title, cwd: '/work', deviceName: '', engine: 'claude' });
  assert.notEqual(normalizeNativeConversationTab({ ...input, deviceId: 'second' }).key, tab.key);
  assert.notEqual(normalizeNativeConversationTab({ ...input, kind: 'local' }).key, tab.key);
  assert.equal(normalizeNativeConversationTab({ ...input, deviceId: '' }), null);
});

test('provider metadata renames existing pages and archives without native action or process stop', () => {
  const state = new NativeConversationTabState(); state.open(terminalConversationTab(record));
  state.open({ kind: 'local', id, title: 'Same UUID in Codex' });
  let rendered = 0; const closed = [];
  const controller = createNativeTerminalTabController({ state, keyFor: value => value.key, normalizeTab: normalizeNativeConversationTab,
    open: tab => state.open(tab), close: key => { closed.push(key); state.close(key); }, render: () => rendered++ });
  controller.syncTerminal([{ ...record, title: '更新标题' }]);
  assert.equal(state.tabs[0].title, '更新标题'); assert.equal(state.tabs[1].title, 'Same UUID in Codex');
  controller.syncTerminal([{ ...record, archived: true }]);
  assert.deepEqual(closed, [`terminal:mac-node/${id}`]); assert.equal(state.tabs.length, 1); assert.equal(rendered, 1);
  controller.syncTerminal([record]); assert.equal(state.tabs.length, 1, 'restoring metadata does not reopen a closed page');
});

function navigationHarness() {
  const sent = [], opened = [], requests = [], waiting = new Map();
  const window = { __cccTerminalConversations: { open(target) { requests.push(target); const task = deferred(); waiting.set(target.conversationId, task); return task.promise; }, select() {}, accept() {} },
    __codexControlConsoleConversationTabs: { openTerminal: value => opened.push(value) } };
  const context = vm.createContext({ window, terminalConversationTab, DASHBOARD_ORIGIN: 'http://127.0.0.1:47831', FRAME_READY_TYPE: 'ready', frame: null,
    openWorkspace(module, label, activate) { context.frame = { contentWindow: { postMessage: (message, origin) => sent.push({ message, origin }) }, hasAttribute: () => true }; opened.push({ module, activate }); }
  });
  vm.runInContext(buildNativeProviderNavigationSource() + ';globalThis.navigation={open:openTerminalConversation,cancel:cancelTerminalNavigation,accept:acceptTerminalMessage};', context);
  return { context, window, waiting, sent, opened, requests, navigation: context.navigation };
}

test('terminal opening routes the stable provider reference into the normal workspace', async () => {
  const h = navigationHarness(); await h.navigation.open(record);
  assert.equal(h.requests.length, 0); assert.deepEqual(h.opened.at(-1), { module: 'terminal', activate: false });
  assert.equal(h.sent[0].message.conversationId, id); assert.equal(h.sent[0].message.reference.provider, 'terminal');
  assert.equal(h.sent[0].origin, 'http://127.0.0.1:47831');
  assert.equal(await h.navigation.open({ provider: 'codex', id }), false);
  assert.equal(await h.navigation.open({ ...record, archived: true }), false);
});

test('latest terminal selection wins and native navigation cancels pending terminal lookup', async () => {
  const h = navigationHarness();
  const first = h.navigation.open({ provider: 'terminal', conversationId: id });
  const second = h.navigation.open({ provider: 'terminal', conversationId: other });
  h.waiting.get(other).resolve({ ...record, id: other }); await second;
  h.waiting.get(id).resolve(record); assert.equal(await first, false);
  assert.deepEqual(h.sent.map(value => value.message.conversationId), [other]);
  const third = h.navigation.open({ provider: 'terminal', conversationId: id }); h.navigation.cancel();
  h.waiting.get(id).resolve(record); assert.equal(await third, false); assert.equal(h.sent.length, 1);
});

test('provider events require both current iframe source and exact origin', async () => {
  const h = navigationHarness(); await h.navigation.open(record);
  const event = { origin: 'http://127.0.0.1:47831', source: h.context.frame.contentWindow, data: { type: 'codex-control-console-terminal-conversation-opened', conversation: record } };
  assert.equal(h.navigation.accept({ ...event, origin: 'http://localhost:47831' }), false);
  assert.equal(h.navigation.accept({ ...event, source: {} }), false);
  assert.equal(h.navigation.accept(event), true);
});

test('native stop and rename changes are delivered only to the active provider target', async () => {
  const h = navigationHarness(); await h.navigation.open(record); h.sent.length = 0;
  const changed = h.window.__codexControlConsoleTerminalChanged;
  assert.equal(changed({ ...record, status: 'stopped', runtimeSessionId: null }), true);
  assert.equal(h.sent[0].message.type, 'codex-control-console-terminal-record-changed');
  assert.equal(h.sent[0].message.conversation.status, 'stopped'); assert.equal(h.sent[0].origin, 'http://127.0.0.1:47831');
  assert.equal(changed({ ...record, id: other, title: '其他会话' }), false);
  assert.equal(changed({ ...record, deviceId: 'other-device' }), false);
  assert.equal(changed({ ...record, title: '重命名', revision: 2 }), true);
  assert.equal(h.sent.at(-1).message.conversation.title, '重命名'); assert.equal(h.sent.length, 2);
  h.navigation.cancel(); assert.equal(changed(record), false); assert.equal(h.sent.length, 2);
});

test('CSP recovery persists the latest stable terminal target, validates it and clears on cancellation', () => {
  const data = new Map(), timers = [], sessionStorage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
  const context = vm.createContext({ sessionStorage, Date, window: {}, document: { body: { setAttribute() {} } }, setTimeout: callback => timers.push(callback) });
  vm.runInContext(buildEmbeddedFrameRecoveryInjectionSource() + ';globalThis.recovery={prepare:requestEmbeddedFramePreparation,schedule:scheduleEmbeddedFrameRecovery,cancel:cancelEmbeddedFrameRecovery};', context);
  context.recovery.prepare('terminal', { provider: 'terminal', conversationId: id });
  context.recovery.prepare('terminal', { provider: 'terminal', conversationId: other });
  let restored; context.recovery.schedule(() => true, value => { restored = value; }); timers.shift()();
  assert.equal(restored.reference.conversationId, other); assert.equal(restored.module, 'terminal');
  context.recovery.cancel(); assert.equal(data.size, 0);
  context.recovery.prepare('terminal', { provider: 'terminal', conversationId: 'invalid' });
  assert.equal(JSON.parse([...data.values()][0]).module, 'board');
});

test('native terminal takes the enclosing focus area so the ChatGPT mode toggle is covered', () => {
  const area = { isConnected: true, getBoundingClientRect: () => ({ width: 718, height: 676 }) };
  const main = found => ({ closest: selector => selector === '[data-app-shell-focus-area="main"]' ? found : null });
  const home = main(area); assert.equal(nativeTerminalHost(() => home), area);
  const bare = main(null); assert.equal(nativeTerminalHost(() => bare), bare);
  const narrow = main({ ...area, getBoundingClientRect: () => ({ width: 200, height: 676 }) }); assert.equal(nativeTerminalHost(() => narrow), narrow);
  const body = {}; assert.equal(nativeTerminalHost(() => body), body);
});

test('native new-chat buttons leave the terminal view; console controls do not', () => {
  const node = (attrs = {}, text = '', inside = '') => {
    const el = { textContent: text, getAttribute: name => attrs[name] ?? null };
    el.closest = selector => {
      if (selector.includes('data-app-action-sidebar-thread-id')) return attrs.row ? el : null;
      if (selector.startsWith('button')) return el;
      return inside && selector.includes(inside) ? {} : null;
    };
    return el;
  };
  for (const label of ['新聊天', 'New chat', '在 mulitca 中开始新聊天', 'New chat in mulitca']) assert.ok(nativeNavigationControl(node({ 'aria-label': label })), label);
  assert.ok(nativeNavigationControl(node({}, '新对话')));
  assert.ok(nativeNavigationControl(node({ row: true })));
  assert.equal(nativeNavigationControl(node({ 'aria-label': '新建聊天首轮使用原生模型' })), null);
  assert.equal(nativeNavigationControl(node({ 'aria-label': 'New chat' }, '', 'data-ccc-terminal-sidebar')), null);
  assert.equal(nativeNavigationControl(node({ 'aria-label': '会话操作：新聊天' })), null);
  assert.equal(nativeNavigationControl(null), null);
  assert.match(buildNativeProviderNavigationSource(), /function nativeNavigationControl/);
});
