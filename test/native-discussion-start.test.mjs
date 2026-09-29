import test from 'node:test';
import assert from 'node:assert/strict';
import { GPT, CLAUDE, GPT_NEW, CLAUDE_NEW, PROJECT, PAIR, event, tick, setup, prepared, startFixture, startWith, toast, chatDom, chatFixture, runChat } from './support/discussion-button-harness.mjs';

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

test('on the new-chat page the button is enabled with no conversation open and shows the composer text as the topic', async () => {
  const f = chatFixture();
  assert.equal(f.trigger.disabled, false);
  await f.open();
  assert.deepEqual(f.requests, [], 'nothing is read from the host before a choice is made');
  assert.ok(f.texts().some(text => /议题（输入框里的内容）：缓存要不要分层？/.test(text)));
  assert.deepEqual(f.menu.all().filter(node => node.dataset.discussStart).map(node => node.textContent), ['GPT 先答', 'Claude 先答']);
  assert.equal(f.menu.all().some(node => node.tag === 'textarea'), false, 'the composer is the topic box');
  const empty = chatFixture({ text: '' }); await empty.open();
  assert.ok(empty.texts().some(text => /先在输入框里写下议题/.test(text)));
});

test('the new-chat mode needs a bare composer: a mounted conversation or a terminal/console view keeps normal behavior', async () => {
  assert.equal(chatFixture({ flags: { mounted: true } }).trigger.disabled, true);
  for (const kind of ['terminal', 'console']) assert.equal(chatFixture({}, { tab: { kind, id: CLAUDE, engine: 'shell' } }).trigger.disabled, true, kind);
  const claudeTab = chatFixture({}, { tab: { kind: 'terminal', id: CLAUDE, engine: 'claude' } });
  await claudeTab.open(); assert.equal(claudeTab.menu.all().some(node => node.tag === 'textarea'), true, 'a Claude tab still gets the topic box');
});

test('GPT first from the new-chat page empties the composer, sends through the native handoff and never reopens new chat', async () => {
  const f = chatFixture();
  await runChat(f, 'gpt');
  assert.deepEqual(f.native.keys, ['local-abc']);
  assert.deepEqual(f.commands, ['selectAll', 'delete']);
  assert.deepEqual(f.native.created, [], 'already on the new-chat page');
  assert.deepEqual(f.native.sent, ['给 GPT 的话']);
  assert.deepEqual(f.requests.filter(item => item.operation === 'prepare'), [{ operation: 'prepare', input: { first: 'gpt', topic: '缓存要不要分层？' } }]);
  assert.deepEqual(f.requests.at(-1), { operation: 'begin', input: { first: 'gpt', topic: '缓存要不要分层？', claudeConversationId: CLAUDE_NEW, gptConversationId: GPT_NEW } });
  assert.ok(toast(f).some(text => /已新建讨论：GPT 先答/.test(text)));
});

test('Claude first from the new-chat page opens the new Claude tab', async () => {
  const f = chatFixture();
  await runChat(f, 'claude');
  assert.equal(f.requests.find(item => item.operation === 'prepare').input.first, 'claude');
  assert.deepEqual(f.native.opened, [CLAUDE_NEW]);
});

test('a native send that failed before submitting puts the topic back in the composer; a submitted one does not', async () => {
  for (const [notSubmitted, restored] of [[true, true], [false, false]]) {
    const f = chatFixture({}, { setup: { starter: { sendFails: true, notSubmitted } } });
    await runChat(f, 'gpt');
    assert.deepEqual(f.commands, restored ? ['selectAll', 'delete', 'insertText'] : ['selectAll', 'delete'], String(notSubmitted));
    assert.ok(toast(f).some(text => /新建讨论失败：原生发送失败/.test(text)));
    assert.deepEqual(f.native.claude, []); assert.equal(f.requests.some(item => item.operation === 'begin'), false);
  }
});

test('new-chat guards: empty composer, no/stale project, several directories, a composer that will not clear', async () => {
  const cases = [
    [chatFixture({ text: '' }), /请先在输入框里写下议题/],
    [chatFixture({ picker: '更改项目：别的项目' }), /不在任何项目里/],
    [chatFixture({ rowLabel: '旧高亮' }), /不在任何项目里/],
    [chatFixture({}, { setup: { project: { id: 'p', sourceDirectories: ['/a', '/b'] } } }), /只有一个目录/],
  ];
  for (const [f, pattern] of cases) {
    await runChat(f, 'gpt');
    assert.ok(toast(f).some(text => pattern.test(text)), String(pattern));
    assert.deepEqual([f.native.sent, f.native.claude, f.commands], [[], [], []]);
  }
  const none = chatFixture({}, { setup: { project: null } }); await runChat(none, 'gpt');
  assert.ok(toast(none).some(text => /不在任何项目里/.test(text)));
  const stuck = chatFixture({ flags: { stuck: true } }); await runChat(stuck, 'gpt');
  assert.ok(toast(stuck).some(text => /输入框未能清空/.test(text)));
  assert.deepEqual([stuck.native.sent, stuck.native.claude], [[], []]);
});
