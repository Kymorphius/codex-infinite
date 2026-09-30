import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversationShortcutLayout } from '../src/native-conversation-shortcut-layout.mjs';
import { mergeRecentSentRecords } from '../src/native-recent-sent-conversations.mjs';
import { buildNativeSentMessageSearchInjectionScript } from '../src/native-sent-message-search.mjs';

const element = () => ({ attrs: new Map(), values: new Map(), isConnected: true,
  setAttribute(k, v) { this.attrs.set(k, v); }, removeAttribute(k) { this.attrs.delete(k); },
  getAttribute(k) { return this.attrs.get(k) ?? null; }, getClientRects() { return this.isConnected ? [{}] : []; },
  get style() { const values = this.values; return { getPropertyValue: k => values.get(k) || '', setProperty(k, v) { values.set(k, v); }, removeProperty(k) { values.delete(k); } }; } });

test('inside a terminal conversation the shortcut bar anchors to the terminal composer and reserves its row there', () => {
  const composer = element(), host = element(), toolbar = element(); toolbar.hidden = true;
  composer.getBoundingClientRect = () => ({ left: 400, top: 640 + (parseFloat(composer.values.get('margin-top')) || 0), width: 800, height: 106 });
  host.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0 });
  toolbar.getBoundingClientRect = () => ({ height: 34, width: 776, left: 412, right: 1188, top: 600, bottom: 634 });
  const window = { innerHeight: 900, innerWidth: 1280, __cccNativeTerminalView: { composer },
    getComputedStyle: node => ({ marginTop: '0px', backgroundColor: node === composer ? 'rgb(54, 54, 54)' : 'transparent', fontFamily: 'system-ui' }) };
  const editor = element(); editor.setAttribute('data-codex-composer', 'true'); editor.setAttribute('contenteditable', 'false'); editor.closest = () => host;
  const document = { head: { append() {} }, createElement: element, querySelectorAll: selector => selector === '[data-codex-composer="true"]' ? [editor] : [],
    querySelector: selector => selector.startsWith('[data-codex-composer="true"]')
      && (!selector.includes('[contenteditable="true"]') || editor.getAttribute('contenteditable') === 'true') ? editor : null };
  const layout = createConversationShortcutLayout(document, window, toolbar);
  layout.update();
  assert.equal(toolbar.hidden, false, 'the bar stays visible although the native composer is hidden');
  assert.equal(composer.values.get('margin-top'), '50px'); assert.equal(host.attrs.size, 0, 'the hidden native composer is not touched');
  assert.equal(toolbar.values.get('left'), '412px'); assert.equal(toolbar.values.get('width'), '776px');
  assert.equal(toolbar.values.get('--ccc-shortcut-surface'), 'rgb(54, 54, 54)');
  assert.equal(900 - parseFloat(toolbar.values.get('bottom')), 690 - 8, 'bar sits 8px above the moved composer');
  composer.isConnected = false; host.getBoundingClientRect = () => ({ left: 180, top: 600, width: 700, height: 100 }); layout.update();
  assert.equal(host.attrs.has('data-ccc-shortcut-space'), true, 'leaving the terminal re-anchors to the native composer');
  assert.equal(toolbar.hidden, false, 'native read-only composer is a valid navigation anchor');
  composer.isConnected = true; layout.update();
  assert.equal(host.attrs.size, 0, 'returning to the terminal releases native reserved spacing');
  assert.equal(toolbar.values.get('left'), '412px'); assert.equal(toolbar.hidden, false);
});

test('recent sent merges Claude CLI conversations by your latest message and skips shells, archived and unsent ones', () => {
  const id = n => `0000000${n}-aaaa-4bbb-8ccc-dddddddddddd`;
  const native = [{ kind: 'local', id: id(1), title: 'Codex', lastUserMessageAt: '2026-09-28T02:00:00.000Z' }];
  const terminal = [
    { provider: 'terminal', kind: 'claude', id: id(2), deviceId: 'mac', title: '看板会话交互', cwd: '/w', lastUserMessageAt: '2026-09-28T03:00:00.000Z' },
    { provider: 'terminal', kind: 'claude', id: id(3), deviceId: 'mac', title: 'old', lastUserMessageAt: '2026-09-28T01:00:00.000Z', archived: true },
    { provider: 'terminal', kind: 'shell', id: id(4), deviceId: 'mac', title: 'shell', lastUserMessageAt: '2026-09-28T04:00:00.000Z' },
    { provider: 'terminal', kind: 'claude', id: id(5), deviceId: 'mac', title: 'never', lastUserMessageAt: null }];
  const merged = mergeRecentSentRecords(native, terminal);
  assert.deepEqual(merged.map(item => [item.kind, item.id]), [['terminal', id(2)], ['local', id(1)]]);
  assert.deepEqual(merged[0], { kind: 'terminal', id: id(2), deviceId: 'mac', title: '看板会话交互', cwd: '/w', engine: 'claude', lastUserMessageAt: '2026-09-28T03:00:00.000Z' });
  assert.equal(mergeRecentSentRecords(native, terminal, 1).length, 1);
});

test('sent-message search routes Claude CLI results to the terminal view and native results to their route', () => {
  const source = buildNativeSentMessageSearchInjectionScript();
  assert.match(source, /if \(item\.kind === 'terminal'\) \{\s*const record = window\.__cccTerminalConversations\?\.records\?\.\(\)\.find/);
  assert.match(source, /__codexControlConsoleOpenTerminalConversation\?\.\(record \|\| \{ provider: 'terminal', conversationId: item\.id, deviceId: item\.deviceId \}\)/);
  assert.match(source, /navigate-to-route', path: '\/local\/' \+ item\.id/);
  assert.doesNotThrow(() => new Function(source));
});

test('Claude rows in 最近会话 / 最近发送 show Claude busy, idle or not running', async () => {
  const { updateNativeRecentStatus, updateClaudeStatus } = await import('../src/native-recent-status.mjs');
  const { buildNativeRecentConversationMenuInjectionSource } = await import('../src/native-recent-conversations.mjs');
  assert.match(buildNativeRecentConversationMenuInjectionSource(), /function updateClaudeStatus/, 'the helper ships with the injected menu');
  const dot = () => ({ dataset: {}, attributes: {}, replaceChildren() {}, setAttribute(name, value) { this.attributes[name] = value; } });
  let records = [{ id: 'c1', claudeStatus: 'busy' }];
  const row = { statusDot: dot() }, tab = { kind: 'terminal', engine: 'claude', id: 'c1' };
  updateNativeRecentStatus({}, row, tab, null, () => records);
  assert.equal(row.statusDot.dataset.status, 'active'); assert.equal(row.statusDot.attributes.title, 'Claude 工作中');
  records = [{ id: 'c1', claudeStatus: 'idle' }]; updateNativeRecentStatus({}, row, tab, null, () => records);
  assert.equal(row.statusDot.dataset.status, 'completed'); assert.equal(row.statusDot.dataset.unread, 'false'); assert.equal(row.statusDot.attributes.title, 'Claude 空闲');
  records = [{ id: 'c1', claudeStatus: null }]; updateNativeRecentStatus({}, row, tab, null, () => records);
  assert.equal(row.statusDot.dataset.status, 'unknown'); assert.equal(row.statusDot.attributes.title, 'Claude 未运行');
  const shell = { statusDot: dot() }; updateNativeRecentStatus({}, shell, { kind: 'terminal', engine: 'shell', id: 's' }, null, () => []);
  assert.equal(shell.statusDot.dataset.status, undefined, 'shell rows keep the plain dot');
  assert.equal(typeof updateClaudeStatus, 'function');
});

test('only states worth a look keep an icon; completed-and-read and idle Claude stay quiet', async () => {
  const { updateNativeRecentStatus } = await import('../src/native-recent-status.mjs');
  const dot = () => ({ dataset: {}, children: [], replaceChildren() { this.children = []; }, append(node) { this.children.push(node); }, setAttribute() {} });
  const id = '019a0000-0000-7000-8000-000000000001', check = { cloneNode: () => 'check-svg' };
  const rail = { classList: { contains: name => ['absolute', 'end-0', 'group-hover:hidden'].includes(name) }, children: [check], querySelector: selector => (selector === 'svg' ? check : null) };
  const documentRef = { querySelector: () => ({ querySelectorAll: () => [rail] }) };
  const status = live => { const row = { statusDot: dot() }; updateNativeRecentStatus(documentRef, row, { kind: 'local', id }, live); return row.statusDot; };
  const read = status({ status: 'completed', unread: false });
  assert.equal(read.dataset.quiet, 'true'); assert.equal(read.children.length, 0, 'no check for an already-read finished conversation');
  assert.equal(status({ status: 'completed', unread: true }).dataset.quiet, 'false', 'unread keeps its dot');
  const interrupted = status({ status: 'interrupted', unread: false });
  assert.equal(interrupted.dataset.quiet, 'false'); assert.equal(interrupted.children.length, 1);
  const claude = value => { const row = { statusDot: dot() }; updateNativeRecentStatus({}, row, { kind: 'terminal', engine: 'claude', id: 'c' }, null, () => [{ id: 'c', claudeStatus: value }]); return row.statusDot.dataset.quiet; };
  assert.deepEqual([claude('busy'), claude('idle'), claude(null)], ['false', 'true', 'true']);
});

test('the quiet rule overrides the more specific completed-check rule', async () => {
  const { NATIVE_RECENT_CONVERSATION_STYLE } = await import('../src/native-recent-conversations.mjs');
  assert.match(NATIVE_RECENT_CONVERSATION_STYLE, /\[data-quiet="true"\]::before\{content:none!important\}/);
  assert.match(NATIVE_RECENT_CONVERSATION_STYLE, /\[data-quiet="true"\]\{background:none!important\}/);
});
