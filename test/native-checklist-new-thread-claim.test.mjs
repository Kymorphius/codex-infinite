import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createNativeChecklistThreadStarter, createNativeChecklistNewThreadClaim } from '../src/native-checklist-new-thread-claim.mjs';
import { createNativeClaimTaskButton, renderNativeClaimTaskButton } from '../src/native-claim-task-control.mjs';

const threadId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const task = { id: 'original', text: '原内容', done: false, assignedThreadId: null, createdAt: '2026-09-20T01:02:03.000Z' };

function nativeHarness({ draft = '', sentText = null, sendAvailable = true } = {}) {
  let mounted = '', sent = 0, dialogOpen = true;
  const listeners = new Set();
  const marker = { getAttribute: () => mounted };
  const editor = { innerText: draft, textContent: draft, focus() {}, closest: () => root };
  const button = { disabled: !sendAvailable, getAttribute: () => '发送', click() { sent += 1; mounted = threadId; } };
  const root = { parentElement: null, querySelector: selector => selector.includes('conversation-id') && mounted ? marker : null,
    querySelectorAll: () => [button] };
  editor.parentElement = root;
  const document = { querySelector: selector => selector.includes('codex-composer') ? editor : selector.includes('ccc-checklist') ? { close() { dialogOpen = false; } } : null,
    execCommand(_command, _show, value) { editor.innerText = value; editor.textContent = value; return false; } };
  const window = { addEventListener(_type, fn) { listeners.add(fn); }, removeEventListener(_type, fn) { listeners.delete(fn); },
    electronBridge: { sendMessageFromView(message) {
      const text = sentText ?? editor.innerText;
      setTimeout(() => { for (const receive of [...listeners]) receive({ data: { type: 'mcp-response', hostId: 'local', message: { id: message.request.id,
        result: { thread: { id: threadId, createdAt: Math.floor(Date.now() / 1000), turns: [{ items: [{ type: 'userMessage', content: [{ type: 'text', text }] }] }] } } } } }); }, 0);
    } } };
  const context = vm.createContext({ document, window, crypto: { randomUUID: () => 'request-id' }, setTimeout, clearTimeout, Date, Promise });
  const start = vm.runInContext(`(${createNativeChecklistThreadStarter.toString()})()`, context);
  return { start, editor, button, sent: () => sent, dialogOpen: () => dialogOpen };
}

test('new-task entry always says 领任务 and opens the new-thread claim view', () => {
  const calls = [];
  const button = { textContent: '', title: '' };
  renderNativeClaimTaskButton(button, 3, null);
  assert.equal(button.textContent, '领任务 3');
  assert.match(button.title, /发送创建新会话/);
  const originalDocument = globalThis.document, originalWindow = globalThis.window;
  try {
    globalThis.document = { createElement: () => ({ addEventListener(_name, fn) { this.click = fn; } }) };
    globalThis.window = { __cccProjectChecklist: { openClaimableForNewThread: () => calls.push('new') } };
    const node = createNativeClaimTaskButton(() => null)();
    node.click({ preventDefault() {}, stopImmediatePropagation() {} });
    assert.deepEqual(calls, ['new']);
  } finally { globalThis.document = originalDocument; globalThis.window = originalWindow; }
});

test('claim sends the latest edited text exactly once, then records delivery without completing the original task', async () => {
  const native = nativeHarness(), actions = [], messages = [];
  const claim = createNativeChecklistNewThreadClaim({ start: native.start, readTask: () => task, enqueue: item => { actions.push(item); return 'saved'; },
    report: message => messages.push(message), showFailure: () => assert.fail('unexpected failure') });
  const first = claim.claim(task.id, () => ({ ...task, text: '1. 最新输入\n2. 保留序号' }));
  const second = claim.claim(task.id, () => assert.fail('duplicate read'));
  await Promise.all([first, second]);
  assert.equal(native.sent(), 1); assert.equal(native.dialogOpen(), false);
  assert.equal(native.editor.innerText, '1. 最新输入\n2. 保留序号');
  assert.deepEqual(actions, [{ ...task, text: native.editor.innerText, done: false, executionState: 'delivered', assignedThreadId: threadId }]);
  assert.match(messages.at(-1), /正在保存/);
});

test('an existing draft prevents sending or task mutation', async () => {
  const native = nativeHarness({ draft: '用户已有草稿' }), actions = [], messages = [];
  const claim = createNativeChecklistNewThreadClaim({ start: native.start, readTask: () => task, enqueue: item => actions.push(item),
    report: message => messages.push(message), showFailure() {} });
  await claim.claim(task.id, () => task);
  assert.equal(native.sent(), 0); assert.equal(native.editor.innerText, '用户已有草稿'); assert.deepEqual(actions, []);
  assert.match(messages.at(-1), /已有内容/);
});

test('a mismatching first native message never completes the task or sends twice', async () => {
  const native = nativeHarness({ sentText: '别的消息' }), actions = [], messages = [];
  const claim = createNativeChecklistNewThreadClaim({ start: native.start, readTask: () => task, enqueue: item => actions.push(item),
    report: message => messages.push(message), showFailure() {} });
  await claim.claim(task.id, () => task);
  assert.equal(native.sent(), 1); assert.deepEqual(actions, []);
  assert.match(messages.at(-1), /不符/);
});
