import test from 'node:test';
import assert from 'node:assert/strict';
import { installNativeDiscussionButton, NATIVE_DISCUSSION_STYLE } from '../src/native-discussion-button.mjs';
import { buildNativeConversationTabsInjectionSource } from '../src/native-conversation-tabs.mjs';

const GPT = '00000000-0000-4000-8000-000000000001';
const CLAUDE = '00000000-0000-4000-8000-000000000002';
const GPT_NEW = '00000000-0000-4000-8000-0000000000b1';
const CLAUDE_NEW = '00000000-0000-4000-8000-0000000000b2';
const PROJECT = { id: 'p1', sourceDirectories: ['/work'] };
const PAIR = { id: '00000000-0000-4000-8000-0000000000aa', round: 1, titles: { claude: 'Claude 设计', gpt: 'GPT 设计' } };

class El {
  constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; this.attrs = {}; this.dataset = {}; this.style = {}; this.disabled = false; this.hidden = false; this.title = ''; this.className = ''; this.ownText = ''; this.value = ''; }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  focus() { this.focused = true; }
  set textContent(value) { this.ownText = String(value); }
  get textContent() { return this.ownText; }
  all() { return [this, ...this.children.flatMap(child => child.all())]; }
}
const event = { preventDefault() {}, stopPropagation() {} };
const tick = () => new Promise(resolve => setImmediate(resolve));

function setup(tab, responses = {}, { starter = null, project = null, records = [] } = {}) {
  const body = new El('body'), root = new El('nav'), docListeners = {}, requests = [];
  const documentRef = { body, createElement: tag => new El(tag), createElementNS: (_, tag) => new El(tag), querySelector: () => null,
    addEventListener: (type, fn) => { docListeners[type] = fn; }, removeEventListener: type => { delete docListeners[type]; } };
  globalThis.window = { __cccDiscussions: { request: async (operation, input) => {
    requests.push({ operation, input });
    const value = responses[operation];
    if (value instanceof Error) throw value;
    return typeof value === 'function' ? value(input) : value;
  } } };
  const native = { created: [], claude: [], opened: [], sent: [] };
  Object.assign(globalThis.window, {
    __codexControlConsoleProjectSearch: { projectOfTask: () => project, projectOfDirectory: () => project },
    __cccProjectSearchActions: { create: async value => { native.created.push(value); return true; } },
    __cccTerminalConversations: { records: () => records, createRecord: async (...args) => { native.claude.push(args); if (starter?.claudeFails) throw Error('终端服务不可用'); return { id: CLAUDE_NEW, cwd: args[1] }; } },
    __codexControlConsoleOpenTerminalConversation: value => native.opened.push(value.id) });
  const createThreadStarter = starter && (() => Object.assign(async text => { native.sent.push(text); if (starter.sendFails) throw Error('原生发送失败'); return GPT_NEW; }, { preflight() { if (starter.preflightFails) throw Error('输入框已有内容，请先处理原有草稿'); } }));
  let active = tab;
  const button = installNativeDiscussionButton({ documentRef, root, activeTab: () => active, createThreadStarter });
  const [trigger, menu] = root.children[0].children;
  const texts = () => menu.all().map(node => node.textContent).filter(Boolean);
  const find = text => menu.all().find(node => node.tag === 'button' && node.all().some(child => child.textContent.includes(text)));
  const open = async () => { trigger.listeners.click(event); await tick(); await tick(); };
  return { button, trigger, menu, body, root, docListeners, requests, native, texts, find, open, setActive(value) { active = value; button.update(); } };
}

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

const prepared = { gptText: '给 GPT 的话', claudeText: '给 Claude 的话' };
const startFixture = (overrides = {}, tab = { kind: 'local', id: GPT }, options = {}) => setup(tab, { 'for-conversation': { discussions: [] }, candidates: { role: 'claude', candidates: [] },
  prepare: prepared, begin: { discussion: PAIR, deliveryError: null }, ...overrides }, { starter: {}, project: PROJECT, ...options });
const startWith = async (f, first, topic = '讨论一下缓存方案') => {
  await f.open();
  f.menu.all().find(node => node.tag === 'textarea').value = topic;
  f.menu.all().find(node => node.dataset.discussStart === first).listeners.click(event);
  for (let i = 0; i < 12; i++) await tick();
};
const toast = f => f.body.children.map(node => node.textContent);

test('unpaired menu offers 新建讨论 (GPT 先答 / Claude 先答) above the pairing candidates', async () => {
  const f = startFixture({ candidates: { role: 'claude', candidates: [{ id: 'peer', title: '已有 Claude' }] } });
  await f.open();
  assert.deepEqual(f.menu.all().filter(node => node.dataset.discussStart).map(node => node.textContent), ['GPT 先答', 'Claude 先答']);
  const texts = f.texts(); assert.ok(texts.indexOf('新建讨论') < texts.findIndex(text => /或与已有的 Claude 会话配对/.test(text)));
  assert.ok(f.find('已有 Claude'));
});

test('GPT first: sends the GPT text through the native handoff, creates Claude quietly, pairs, stays on GPT', async () => {
  const f = startFixture();
  await startWith(f, 'gpt');
  assert.deepEqual(f.requests.filter(item => ['prepare', 'begin'].includes(item.operation)), [
    { operation: 'prepare', input: { first: 'gpt', topic: '讨论一下缓存方案' } },
    { operation: 'begin', input: { first: 'gpt', topic: '讨论一下缓存方案', claudeConversationId: CLAUDE_NEW, gptConversationId: GPT_NEW } }]);
  assert.deepEqual(f.native.created, [PROJECT]);
  assert.deepEqual(f.native.sent, ['给 GPT 的话']);
  assert.deepEqual(f.native.claude, [[PROJECT, '/work', 'claude', { open: false }]]);
  assert.deepEqual(f.native.opened, []);
  assert.equal(f.menu.hidden, true); assert.ok(toast(f).some(text => /已新建讨论：GPT 先答/.test(text)));
});

test('Claude first from a Claude tab opens the new Claude conversation and reports a Claude that was not ready', async () => {
  const claudeTab = { kind: 'terminal', id: CLAUDE, engine: 'claude' };
  const f = startFixture({ begin: { discussion: PAIR, deliveryError: 'Claude 还没有就绪' } }, claudeTab, { records: [{ id: CLAUDE, cwd: '/work' }] });
  await startWith(f, 'claude');
  assert.equal(f.requests.find(item => item.operation === 'prepare').input.first, 'claude');
  assert.deepEqual(f.native.opened, [CLAUDE_NEW]);
  assert.ok(toast(f).some(text => /Claude 未收到开场消息：Claude 还没有就绪/.test(text)));
});

test('nothing is created for an empty topic, a project without exactly one directory, or a missing project', async () => {
  const empty = startFixture(); await startWith(empty, 'gpt', '   ');
  const many = startFixture({}, undefined, { project: { id: 'p', sourceDirectories: ['/a', '/b'] } }); await startWith(many, 'gpt');
  const none = startFixture({}, undefined, { project: null }); await startWith(none, 'claude');
  for (const [f, pattern] of [[empty, /请先写下议题/], [many, /只有一个目录/], [none, /找不到当前会话所属项目/]]) {
    assert.ok(toast(f).some(text => pattern.test(text)), String(pattern));
    assert.deepEqual([f.native.created, f.native.sent, f.native.claude], [[], [], []]);
    assert.equal(f.requests.some(item => ['prepare', 'begin'].includes(item.operation)), false);
  }
});

test('a native handoff that fails before sending creates no Claude conversation and no pairing', async () => {
  const draft = startFixture({}, undefined, { starter: { preflightFails: true } }); await startWith(draft, 'gpt');
  assert.ok(toast(draft).some(text => /新建讨论失败：输入框已有内容/.test(text)));
  const send = startFixture({}, undefined, { starter: { sendFails: true } }); await startWith(send, 'gpt');
  assert.ok(toast(send).some(text => /新建讨论失败：原生发送失败/.test(text)));
  for (const f of [draft, send]) { assert.deepEqual(f.native.claude, []); assert.equal(f.requests.some(item => item.operation === 'begin'), false); }
});

test('once GPT exists, a Claude creation failure says so and points at manual pairing', async () => {
  const f = startFixture({}, undefined, { starter: { claudeFails: true } });
  await startWith(f, 'gpt');
  assert.ok(toast(f).some(text => /已创建 GPT 会话，但后续步骤失败：终端服务不可用.*与已有会话配对/.test(text)));
  assert.equal(f.requests.some(item => item.operation === 'begin'), false);
});

test('a second click while a discussion is being created does nothing', async () => {
  const f = startFixture();
  await f.open();
  f.menu.all().find(node => node.tag === 'textarea').value = '议题';
  const gptButton = f.menu.all().find(node => node.dataset.discussStart === 'gpt');
  gptButton.listeners.click(event); gptButton.listeners.click(event);
  for (let i = 0; i < 12; i++) await tick();
  assert.equal(f.native.sent.length, 1);
});
