import test from 'node:test';
import assert from 'node:assert/strict';
import { installNativeArchiveButton, NATIVE_ARCHIVE_STYLE } from '../src/native-archive-button.mjs';
import { buildNativeConversationTabsInjectionSource } from '../src/native-conversation-tabs.mjs';
import { El, event, tick } from './support/discussion-button-harness.mjs';

const GPT = '00000000-0000-4000-8000-000000000001';
const CLAUDE = '00000000-0000-4000-8000-000000000002';

function setup(tab, { nativeError = null, updateError = null, records = [{ id: CLAUDE, revision: 7 }] } = {}) {
  const body = new El('body'), root = new El('nav'), sent = [], updates = [], accepted = [], closed = [], listeners = {};
  const documentRef = { body, createElement: tag => Object.assign(new El(tag), tag === 'dialog' ? { showModal() { this.open = true; }, close() { this.open = false; } } : {}), createElementNS: (_, tag) => new El(tag) };
  globalThis.window = {
    addEventListener: (type, fn) => { listeners[type] = fn; }, removeEventListener: type => { delete listeners[type]; },
    electronBridge: { sendMessageFromView(message) {
      sent.push(message);
      const reply = nativeError ? { id: message.request.id, error: { message: nativeError } } : { id: message.request.id, result: {} };
      setTimeout(() => listeners.message?.({ data: { type: 'mcp-response', hostId: 'local', message: { id: 'other' } } }), 0);
      setTimeout(() => listeners.message?.({ data: { type: 'mcp-response', hostId: 'local', message: reply } }), 0);
    } },
    __cccTerminalConversations: { records: () => records, accept: value => accepted.push(value),
      request: async (operation, input) => { updates.push({ operation, input }); if (updateError) throw Error(updateError); return { conversation: { id: input.id, archived: true } }; } }
  };
  let active = tab;
  const button = installNativeArchiveButton({ documentRef, root, activeTab: () => active, closeTab: value => closed.push(value) });
  const trigger = root.children[0].children[0];
  const dialog = () => body.children.find(node => node.tag === 'dialog');
  const press = text => dialog().all().find(node => node.tag === 'button' && node.textContent === text).listeners.click(event);
  const toast = () => body.children.filter(node => node.tag === 'div').map(node => node.textContent);
  return { button, trigger, root, body, sent, updates, accepted, closed, listeners, dialog, press, toast, setActive(value) { active = value; button.update(); } };
}

test('enabled only for GPT and Claude conversations; destroy removes it', () => {
  const f = setup({ kind: 'local', id: GPT, title: '缓存方案' });
  assert.equal(f.trigger.children.at(-1).textContent, '归档');
  assert.equal(f.trigger.disabled, false);
  for (const tab of [{ kind: 'terminal', id: CLAUDE, engine: 'shell' }, { kind: 'chatgpt', id: GPT }, { kind: 'console' }, null, { kind: 'local', id: 'nope' }]) {
    f.setActive(tab); assert.equal(f.trigger.disabled, true, JSON.stringify(tab));
    f.trigger.listeners.click(event); assert.equal(f.dialog(), undefined);
  }
  f.setActive({ kind: 'terminal', id: CLAUDE, engine: 'claude' }); assert.equal(f.trigger.disabled, false);
  f.button.destroy(); assert.equal(f.root.children.length, 0);
});

test('clicking asks for confirmation; cancel archives nothing', async () => {
  const f = setup({ kind: 'local', id: GPT, title: '缓存方案' });
  f.trigger.listeners.click(event);
  assert.equal(f.dialog().open, true);
  assert.ok(f.dialog().all().some(node => /将归档「缓存方案」/.test(node.textContent)));
  f.press('取消'); await tick();
  assert.equal(f.dialog(), undefined);
  assert.deepEqual(f.sent, []); assert.deepEqual(f.closed, []);
});

test('confirming archives a GPT conversation through the native thread/archive request and closes its tab', async () => {
  const tab = { kind: 'local', id: GPT, title: '缓存方案' }, f = setup(tab);
  f.trigger.listeners.click(event); f.press('归档'); f.press('归档');
  await tick(); await tick();
  assert.equal(f.sent.length, 1);
  assert.deepEqual({ ...f.sent[0], request: { ...f.sent[0].request, id: 'x' } }, { type: 'mcp-request', hostId: 'local', retainResponse: true, request: { id: 'x', method: 'thread/archive', params: { threadId: GPT } } });
  assert.deepEqual(f.closed, [tab]); assert.equal(f.dialog(), undefined);
  assert.equal(f.listeners.message, undefined);
  assert.match(f.toast().at(-1), /已归档「缓存方案」/);
});

test('confirming archives a Claude conversation with its current revision', async () => {
  const tab = { kind: 'terminal', id: CLAUDE, engine: 'claude', title: 'Claude 设计' }, f = setup(tab);
  f.trigger.listeners.click(event); f.press('归档'); await tick();
  assert.deepEqual(f.updates, [{ operation: 'update', input: { id: CLAUDE, expectedRevision: 7, archived: true } }]);
  assert.deepEqual(f.accepted, [{ id: CLAUDE, archived: true }]);
  assert.deepEqual(f.closed, [tab]);
});

test('a failed archive keeps the dialog and tab, and reports the reason', async () => {
  const gpt = setup({ kind: 'local', id: GPT }, { nativeError: '会话正在运行' });
  gpt.trigger.listeners.click(event); gpt.press('归档'); await tick(); await tick();
  assert.equal(gpt.dialog().open, true); assert.deepEqual(gpt.closed, []);
  assert.match(gpt.toast().at(-1), /归档失败：会话正在运行/);
  const claude = setup({ kind: 'terminal', id: CLAUDE, engine: 'claude' }, { records: [] });
  claude.trigger.listeners.click(event); claude.press('归档'); await tick();
  assert.deepEqual(claude.updates, []); assert.match(claude.toast().at(-1), /找不到这个 Claude 会话/);
});

test('the tab injection installs the archive button and its style', () => {
  const source = buildNativeConversationTabsInjectionSource();
  assert.match(source, /installNativeArchiveButton\(\{ documentRef: document, root: shortcutRoot/);
  assert.ok(source.includes(JSON.stringify(NATIVE_ARCHIVE_STYLE).slice(1, 40)));
});
