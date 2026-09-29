import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DiscussionService } from '../src/discussion-service.mjs';
import { DiscussionStore } from '../src/discussion-store.mjs';

const CLAUDE = '22222222-2222-4222-8222-222222222222';
const GPT = '33333333-3333-4333-8333-333333333333';

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'discussions-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const state = { answers: { claude: { turnId: 'c1', text: 'Claude 的方案', at: 't' }, gpt: { turnId: 'g1', text: 'GPT 的方案', at: 't' } },
    sent: [], refuse: null, cwd: { claude: '/proj', gpt: '/proj/' } };
  const side = role => ({ resolve: async () => ({ cwd: state.cwd[role], title: role }), latestAnswer: async () => state.answers[role],
    deliver: async (id, text) => { if (state.refuse) throw state.refuse; state.sent.push({ role, id, text }); } });
  const filePath = path.join(directory, 'discussions.json');
  const make = () => new DiscussionService({ store: new DiscussionStore({ filePath, deviceId: 'owner' }), participants: { claude: side('claude'), gpt: side('gpt') } });
  const service = make();
  const { discussion } = await service.create({ claudeConversationId: CLAUDE, gptConversationId: GPT });
  return { service, state, discussion, make, filePath };
}

test('pairing requires the same project directory and is idempotent', async t => {
  const { service, state, discussion } = await fixture(t);
  assert.equal(discussion.participants.length, 2);
  assert.equal((await service.create({ claudeConversationId: CLAUDE, gptConversationId: GPT })).discussion.id, discussion.id);
  state.cwd.gpt = '/other';
  await assert.rejects(service.create({ claudeConversationId: randomUUID(), gptConversationId: randomUUID() }), { statusCode: 409 });
});

test('forward delivers the answer once with a comment and refuses the same answer again', async t => {
  const { service, state, discussion } = await fixture(t);
  const result = await service.forward({ id: discussion.id, from: 'claude', comment: '我不同意第二点' });
  assert.deepEqual(result.forwarded, { from: 'claude', to: 'gpt', round: 1 });
  assert.equal(state.sent.length, 1);
  assert.equal(state.sent[0].role, 'gpt');
  assert.match(state.sent[0].text, /来自 Claude[\s\S]*Claude 的方案[\s\S]*\[主持人点评\]\n我不同意第二点/);
  await assert.rejects(service.forward({ id: discussion.id, from: 'claude', comment: '' }), { statusCode: 409 });
  assert.equal(state.sent.length, 1);
  // a new answer is forwardable, the other direction is independent
  state.answers.claude = { turnId: 'c2', text: '修订方案', at: 't' };
  await service.forward({ id: discussion.id, from: 'claude', comment: '' });
  await service.forward({ id: discussion.id, from: 'gpt', comment: '' });
  assert.equal(state.sent.length, 3);
});

test('concurrent forwards of one answer deliver exactly once', async t => {
  const { service, state, discussion } = await fixture(t);
  const results = await Promise.allSettled([1, 2, 3].map(() => service.forward({ id: discussion.id, from: 'gpt', comment: '' })));
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(state.sent.length, 1);
});

test('a refused delivery keeps the comments and cursor so the forward can be retried', async t => {
  const { service, state, discussion } = await fixture(t);
  await service.comment({ id: discussion.id, text: '先记下这条' });
  state.refuse = Object.assign(new Error('Claude 正在回复'), { statusCode: 409 });
  await assert.rejects(service.forward({ id: discussion.id, from: 'gpt', comment: '' }), { statusCode: 409 });
  const before = (await service.get({ id: discussion.id })).discussion;
  assert.equal(before.cursors.gpt, null);
  assert.deepEqual(before.pendingComments, ['先记下这条']);
  state.refuse = null;
  await service.forward({ id: discussion.id, from: 'gpt', comment: '' });
  assert.match(state.sent[0].text, /先记下这条/);
  assert.deepEqual((await service.get({ id: discussion.id })).discussion.pendingComments, []);
});

test('latest previews the answer and marks it once forwarded', async t => {
  const { service, discussion } = await fixture(t);
  assert.equal((await service.latest({ id: discussion.id, from: 'gpt' })).answer.forwarded, false);
  await service.forward({ id: discussion.id, from: 'gpt', comment: '' });
  assert.equal((await service.latest({ id: discussion.id, from: 'gpt' })).answer.forwarded, true);
});

test('state survives a restart without re-forwarding; stop discards comments and blocks forwarding', async t => {
  const { service, state, discussion, make } = await fixture(t);
  await service.forward({ id: discussion.id, from: 'claude', comment: '' });
  const restarted = make();
  await assert.rejects(restarted.forward({ id: discussion.id, from: 'claude', comment: '' }), { statusCode: 409 });
  await restarted.comment({ id: discussion.id, text: '待发' });
  const stopped = (await restarted.stop({ id: discussion.id })).discussion;
  assert.equal(stopped.status, 'stopped');
  assert.deepEqual(stopped.pendingComments, []);
  await assert.rejects(restarted.forward({ id: discussion.id, from: 'gpt', comment: '' }), { statusCode: 409 });
  assert.equal(state.sent.length, 1);
});

test('corrupt store fails closed without overwriting the original file', async t => {
  const { filePath, make } = await fixture(t);
  await fs.writeFile(filePath, 'not json');
  await assert.rejects(make().list(), { statusCode: 503 });
  assert.equal(await fs.readFile(filePath, 'utf8'), 'not json');
});
