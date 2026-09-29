import test from 'node:test';
import assert from 'node:assert/strict';
import { planForward, applyForward } from '../src/discussion-policy.mjs';
import { forwardEnvelope, discussionForwardInput, discussionCreateInput, discussionPrepareInput, discussionBeginInput, cleanText } from '../src/discussion-contract.mjs';

const ID = '11111111-1111-4111-8111-111111111111';
const base = () => ({ id: ID, status: 'idle', round: 0, cursors: { claude: null, gpt: null }, pendingComments: [], messages: [], revision: 1 });
const answer = { turnId: 't1', text: '我建议先拆模块', at: '2026-09-29T01:00:00Z' };

test('forward plan tags the source, numbers the round and puts comments after the answer', () => {
  const plan = planForward({ discussion: base(), from: 'claude', answer, comment: '我倾向先做接口' });
  assert.equal(plan.ok, true);
  assert.equal(plan.to, 'gpt');
  assert.equal(plan.round, 1);
  assert.equal(plan.text, '[来自 Claude · 讨论 11111111 · 第 1 轮]\n我建议先拆模块\n\n[主持人点评]\n我倾向先做接口');
});

test('pending comments precede the inline comment and no comment leaves a bare answer', () => {
  const discussion = { ...base(), pendingComments: ['A', 'B'] };
  assert.deepEqual(planForward({ discussion, from: 'gpt', answer, comment: 'C' }).comments, ['A', 'B', 'C']);
  assert.equal(planForward({ discussion: base(), from: 'gpt', answer }).text.includes('主持人点评'), false);
});

test('an answer already forwarded, a missing answer and a stopped discussion are refused', () => {
  const forwarded = { ...base(), cursors: { claude: 't1', gpt: null } };
  assert.equal(planForward({ discussion: forwarded, from: 'claude', answer }).status, 409);
  assert.equal(planForward({ discussion: base(), from: 'claude', answer: null }).ok, false);
  assert.equal(planForward({ discussion: { ...base(), status: 'stopped' }, from: 'claude', answer }).ok, false);
  // the other side's cursor is independent
  assert.equal(planForward({ discussion: forwarded, from: 'gpt', answer }).ok, true);
});

test('applying a forward moves only the sender cursor, consumes comments and keeps the timeline bounded', () => {
  let n = 0; const idFactory = () => `m${++n}`;
  const discussion = { ...base(), pendingComments: ['旧点评'] };
  const plan = planForward({ discussion, from: 'claude', answer, comment: '新点评' });
  const next = applyForward({ discussion, from: 'claude', plan, answer, at: '2026-09-29T02:00:00Z', idFactory, maxMessages: 3 });
  assert.deepEqual(next.cursors, { claude: 't1', gpt: null });
  assert.deepEqual(next.pendingComments, []);
  assert.equal(next.round, 1);
  assert.equal(next.revision, 2);
  assert.deepEqual(next.messages.map(item => item.kind), ['comment', 'comment', 'forward']); // answer trimmed by the bound
});

test('envelope refuses oversize text; inputs reject unknown fields, bad ids and control characters', () => {
  assert.throws(() => forwardEnvelope({ discussionId: ID, from: 'gpt', round: 1, answer: 'x'.repeat(12_000), comments: ['y'] }), { statusCode: 413 });
  assert.throws(() => discussionForwardInput({ id: ID, from: 'claude', extra: 1 }), { statusCode: 400 });
  assert.throws(() => discussionForwardInput({ id: 'nope', from: 'claude' }), { statusCode: 400 });
  assert.throws(() => discussionForwardInput({ id: ID, from: 'bard' }), { statusCode: 400 });
  assert.throws(() => discussionCreateInput({ claudeConversationId: ID }), { statusCode: 400 });
  assert.equal(cleanText('a\u0000b\u001b', 10, '点评'), 'ab');
  assert.throws(() => cleanText('x'.repeat(5), 4, '点评'), { statusCode: 413 });
});

test('prepare and begin inputs need a topic, a role and exact fields', () => {
  assert.deepEqual(discussionPrepareInput({ first: 'claude', topic: ' 议题\u0000 ' }), { first: 'claude', topic: '议题' });
  assert.throws(() => discussionPrepareInput({ first: 'claude', topic: '  ' }), { statusCode: 400 });
  assert.throws(() => discussionPrepareInput({ first: 'bard', topic: 'x' }), { statusCode: 400 });
  assert.throws(() => discussionPrepareInput({ first: 'gpt', topic: 'x'.repeat(8001) }), { statusCode: 413 });
  assert.throws(() => discussionPrepareInput({ first: 'gpt', topic: 'x', extra: 1 }), { statusCode: 400 });
  const ids = { claudeConversationId: ID, gptConversationId: '33333333-3333-4333-8333-333333333333' };
  assert.deepEqual(discussionBeginInput({ first: 'gpt', topic: 'x', ...ids }), { first: 'gpt', topic: 'x', ...ids });
  assert.throws(() => discussionBeginInput({ first: 'gpt', topic: 'x', claudeConversationId: ID }), { statusCode: 400 });
});
