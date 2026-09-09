import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sourceId, ownerId, readSharedMessages, HermesSharedSource } from '../src/hermes-shared-source.mjs';
const id = '11111111-1111-4111-8111-111111111111';
const row = (role, text, channel = 'final') => JSON.stringify({ type: 'response_item', payload: { type: 'message', role, channel, content: [{ type: 'text', text }] } }) + '\n';
test('shared identities cannot silently fall through to Hermes sessions', () => {
  assert.equal(ownerId(sourceId(id)), id);
  for (const value of ['hermes:abc', id, 'codex:../../history', null]) assert.throws(() => ownerId(value));
});
test('history remains authoritative, paginated, and complete for long public text', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hermes-shared-'));
  try {
    const file = path.join(dir, 'session.jsonl');
    await fs.writeFile(file, row('user', 'first') + row('assistant', 'private', 'analysis') + row('assistant', 'a'.repeat(40000)) + '{');
    const first = await readSharedMessages(file, { limit: 1 });
    assert.equal(first.total, 2); assert.equal(first.messages[0].content.length, 40000);
    assert.equal((await readSharedMessages(file, { limit: 1, offset: 1 })).messages[0].content, 'first');
    await fs.writeFile(file, row('user', 'first') + row('assistant', 'latest'));
    assert.equal((await readSharedMessages(file)).messages.at(-1).content, 'latest');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test('sending routes the original identity through owner draft protection', async () => {
  let input;
  const item = { id, archived: false };
  const service = new HermesSharedSource({ catalog: { snapshot: async () => ({ conversations: [item], projects: [] }) },
    remoteMessageService: { submit: async value => { input = value; return { accepted: true }; } } });
  await service.send(sourceId(id), 'hello');
  assert.deepEqual(input, { threadId: id, prompt: 'hello', expectedDraftRevision: null, deliveryMode: 'new-turn' });
  item.archived = true;
  await assert.rejects(service.send(sourceId(id), 'hello'), /archived/);
});
test('interrupt cannot target a newer turn than the one displayed', async () => {
  const calls = [];
  const service = new HermesSharedSource({
    catalog: { snapshot: async () => ({ conversations: [{ id }], projects: [] }), transcriptPath: async () => '/unused' },
    messages: async () => ({ activeTurnId: id, messages: [] }),
    nativeConversationAdapter: { interruptTurn: async value => calls.push(value) }
  });
  await assert.rejects(service.interrupt(sourceId(id), null), /轮次/);
  await assert.rejects(service.interrupt(sourceId(id), 'other'), /轮次/);
  await service.interrupt(sourceId(id), id);
  assert.deepEqual(calls, [{ threadId: id, turnId: id }]);
});
