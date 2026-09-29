import test from 'node:test';
import assert from 'node:assert/strict';
import { NATIVE_DISCUSSION_STYLE } from '../src/native-discussion-button.mjs';
import { buildNativeConversationTabsInjectionSource } from '../src/native-conversation-tabs.mjs';
import { GPT, CLAUDE, PAIR, event, tick, setup } from './support/discussion-button-harness.mjs';

test('enabled only for GPT and Claude conversations; closes when disabled; destroy cleans up', async () => {
  const f = setup({ kind: 'local', id: GPT }, { 'for-conversation': { discussions: [] }, candidates: { role: 'claude', candidates: [] } });
  assert.equal(f.trigger.children.at(-1).textContent, '讨论');
  assert.equal(f.trigger.disabled, false);
  await f.open(); assert.equal(f.menu.hidden, false);
  for (const tab of [{ kind: 'terminal', id: CLAUDE, engine: 'shell' }, { kind: 'chatgpt', id: GPT }, { kind: 'console' }, null, { kind: 'local', id: 'nope' }]) {
    f.setActive(tab); assert.equal(f.trigger.disabled, true, JSON.stringify(tab)); assert.equal(f.menu.hidden, true);
  }
  f.setActive({ kind: 'terminal', id: CLAUDE, engine: 'claude' }); assert.equal(f.trigger.disabled, false);
  f.docListeners.keydown({ key: 'Escape', preventDefault() {} });
  f.button.destroy(); assert.equal(f.root.children.length, 0); assert.deepEqual(f.docListeners, {});
});

test('unpaired: lists candidates of the other kind and pairs with the right roles', async () => {
  for (const [tab, role, otherRole, expected] of [
    [{ kind: 'local', id: GPT }, 'gpt', 'claude', { claudeConversationId: 'peer', gptConversationId: GPT }],
    [{ kind: 'terminal', id: CLAUDE, engine: 'claude' }, 'claude', 'gpt', { claudeConversationId: CLAUDE, gptConversationId: 'peer' }]]) {
    const f = setup(tab, { 'for-conversation': { discussions: [] }, candidates: { role: otherRole, candidates: [{ id: 'peer', title: '同项目会话' }] }, create: {} });
    await f.open();
    assert.deepEqual(f.requests.slice(0, 2), [{ operation: 'for-conversation', input: { conversationId: tab.id } }, { operation: 'candidates', input: { conversationId: tab.id, role } }]);
    f.find('同项目会话').listeners.click(event); await tick();
    assert.deepEqual(f.requests.at(-1), { operation: 'create', input: expected });
    assert.equal(f.menu.hidden, true);
    assert.match(f.body.children.at(-1).textContent, /已配对/);
  }
});

test('unpaired with no candidates explains what to do; a failed read shows the error', async () => {
  const empty = setup({ kind: 'local', id: GPT }, { 'for-conversation': { discussions: [] }, candidates: { role: 'claude', candidates: [] } });
  await empty.open(); assert.ok(empty.texts().some(text => /没有可配对的 Claude 会话/.test(text)));
  const broken = setup({ kind: 'local', id: GPT }, { 'for-conversation': new Error('服务不可用') });
  await broken.open(); assert.ok(broken.texts().includes('服务不可用'));
  globalThis.window = {};
  const missing = setup({ kind: 'local', id: GPT }); delete globalThis.window.__cccDiscussions;
  await missing.open(); assert.ok(missing.texts().some(text => /尚未就绪/.test(text)));
});

test('paired: forwards the chosen side with the typed comment, once, then closes', async () => {
  const f = setup({ kind: 'local', id: GPT }, { 'for-conversation': { discussions: [PAIR] },
    latest: { answer: { turnId: 't', text: 'GPT 的回答', forwarded: false }, pendingComments: [] }, forward: {} });
  await f.open();
  assert.ok(f.texts().some(text => /已与 Claude 设计 配对 · 已转发 1 次/.test(text)));
  f.find('把这边的回答转给 Claude').listeners.click(event); await tick(); await tick();
  assert.deepEqual(f.requests.at(-1), { operation: 'latest', input: { id: PAIR.id, from: 'gpt' } });
  assert.ok(f.texts().includes('GPT 的回答'));
  const comment = f.menu.all().find(node => node.tag === 'textarea'); comment.value = '我更倾向方案二';
  const send = f.find('转发'); assert.equal(send.disabled, false);
  send.listeners.click(event); send.listeners.click(event); await tick(); await tick();
  assert.deepEqual(f.requests.filter(item => item.operation === 'forward'), [{ operation: 'forward', input: { id: PAIR.id, from: 'gpt', comment: '我更倾向方案二' } }]);
  assert.equal(f.menu.hidden, true); assert.match(f.body.children.at(-1).textContent, /已把 GPT 的回答转给 Claude/);
});

test('the other side can be forwarded here; an already-forwarded or missing answer cannot be sent', async () => {
  const f = setup({ kind: 'local', id: GPT }, { 'for-conversation': { discussions: [PAIR] },
    latest: input => input.from === 'claude' ? { answer: { turnId: 'c', text: 'x', forwarded: true }, pendingComments: ['旧点评'] } : { answer: null, pendingComments: [] } });
  await f.open();
  f.find('把 Claude 的回答转给这边').listeners.click(event); await tick(); await tick();
  assert.equal(f.requests.at(-1).input.from, 'claude');
  assert.equal(f.find('转发').disabled, true);
  assert.ok(f.texts().some(text => /已经转发过/.test(text))); assert.ok(f.texts().some(text => /1 条已记下的点评/.test(text)));
  f.find('返回').listeners.click(event);
  f.find('把这边的回答转给 Claude').listeners.click(event); await tick(); await tick();
  assert.equal(f.find('转发').disabled, true); assert.ok(f.texts().some(text => /还没有可转发的回答/.test(text)));
});

test('a refused forward keeps the panel open with an error toast; unpair stops the discussion', async () => {
  const f = setup({ kind: 'terminal', id: CLAUDE, engine: 'claude' }, { 'for-conversation': { discussions: [PAIR] },
    latest: { answer: { turnId: 't', text: 'ok', forwarded: false }, pendingComments: [] }, forward: new Error('GPT 正在回复'), stop: {} });
  await f.open();
  f.find('把这边的回答转给 GPT').listeners.click(event); await tick(); await tick();
  const send = f.find('转发'); send.listeners.click(event); await tick(); await tick();
  assert.equal(f.menu.hidden, false); assert.equal(send.disabled, false); assert.equal(f.body.children.at(-1).textContent, 'GPT 正在回复');
  f.find('返回').listeners.click(event);
  f.find('解除配对').listeners.click(event); await tick();
  assert.deepEqual(f.requests.at(-1), { operation: 'stop', input: { id: PAIR.id } });
});

test('the injected tabs source ships the button, the client and the style', () => {
  const source = buildNativeConversationTabsInjectionSource();
  assert.match(source, /function installNativeDiscussionButton/);
  assert.match(source, /installNativeDiscussionButton\(\{ documentRef: document, root: shortcutRoot, activeTab, createThreadStarter: createNativeChecklistThreadStarter \}\)/);
  assert.match(source, /function createNativeChecklistThreadStarter/);
  assert.match(source, /__cccDiscussions/);
  assert.match(source, /discussionButton\?\.destroy\(\)/);
  assert.ok(source.includes('ccc-native-discuss-preview') && NATIVE_DISCUSSION_STYLE.includes('ccc-native-discuss-comment'));
});
