import test from 'node:test';
import assert from 'node:assert/strict';
import { createClaudeParticipant, createGptParticipant } from '../src/discussion-runtime.mjs';

const ID = '22222222-2222-4222-8222-222222222222';

function claudeFixture(view, record = { id: ID, kind: 'claude', cwd: '/proj', title: 'C' }) {
  const writes = [];
  const participant = createClaudeParticipant({
    terminalConversations: { store: { get: async () => { if (!record) throw Error('missing'); return record; } }, view: async () => view,
      claudeTranscripts: { summary: async () => ({ ids: [ID] }) } },
    terminalService: { get: id => { assert.equal(id, 'pty-1'); return { pty: { write: data => writes.push(data) } }; } },
    userHome: '/nowhere', delay: async () => writes.push('<delay>') });
  return { participant, writes };
}

test('Claude delivery pastes the text, waits, then submits with Enter', async () => {
  const { participant, writes } = claudeFixture({ status: 'running', runtimeSessionId: 'pty-1', claudeStatus: 'idle' });
  await participant.deliver(ID, '第一行\n第二行');
  assert.deepEqual(writes, ['\x1b[200~第一行\n第二行\x1b[201~', '<delay>', '\r']);
});

test('Claude delivery refuses a stopped, busy or unknown conversation and writes nothing', async () => {
  for (const [view, record, status] of [
    [{ status: 'stopped', runtimeSessionId: null }, undefined, 409],
    [{ status: 'running', runtimeSessionId: 'pty-1', claudeStatus: 'busy' }, undefined, 409],
    [{}, null, 404]]) {
    const { participant, writes } = claudeFixture(view, record);
    await assert.rejects(participant.deliver(ID, 'x'), { statusCode: status });
    assert.deepEqual(writes, []);
  }
});

test('Claude resolve accepts only Claude conversations; GPT sends through the remote message path in queue mode', async () => {
  assert.equal(await claudeFixture({}, { id: ID, kind: 'shell', cwd: '/p' }).participant.resolve(ID), null);
  assert.deepEqual(await claudeFixture({}).participant.resolve(ID), { cwd: '/proj', title: 'C' });
  const sent = [];
  const gpt = createGptParticipant({ localAdapter: { getTask: async id => id === ID ? { cwd: '/proj', title: 'G' } : null },
    remoteMessageService: { submit: async input => sent.push(input) }, transcriptPathOf: async () => null });
  assert.deepEqual(await gpt.resolve(ID), { cwd: '/proj', title: 'G' });
  assert.equal(await gpt.resolve('nope'), null);
  await gpt.deliver(ID, 'hello');
  assert.deepEqual(sent, [{ threadId: ID, prompt: 'hello', deliveryMode: 'queue' }]);
  assert.equal(await gpt.latestAnswer(ID), null);
});
