import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { git } from '../src/project-sync-git.mjs';
import { LocalConversationContinuationAdapter } from '../src/local-conversation-continuation-adapter.mjs';
import { NativeConversationContinuation } from '../src/native-conversation-continuation.mjs';
import { ConversationContinuationService } from '../src/conversation-continuation-service.mjs';

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'continuation-local-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const target = path.join(root, 'project'); await fs.mkdir(target);
  await git(target, ['init', '--template=', '-b', 'main']);
  await fs.writeFile(path.join(target, 'tracked'), 'initial');
  await git(target, ['add', 'tracked']);
  await git(target, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'initial']);
  let identity = randomUUID();
  const native = new NativeConversationContinuation({ codexHome: path.join(root, 'home'), receiptRoot: path.join(root, 'receipts') });
  const adapter = new LocalConversationContinuationAdapter({
    projectProvider: async () => [{ path: target, name: 'Fixture' }], taskProvider: async () => [],
    identityStore: { read: async () => new Map([[target, identity]]) }, continuation: native
  });
  const expected = { ...await adapter.inspect({ path: target }), deviceId: 'target' };
  const threadId = randomUUID(), timestamp = '2026-09-30T00:00:00.000Z', cwd = '/source';
  const body = Buffer.from(JSON.stringify({ type: 'response_item', timestamp, payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'fixture' }] } }) + '\n');
  const bytes = Buffer.concat([Buffer.from(JSON.stringify({ type: 'session_meta', timestamp, payload: { id: threadId, timestamp, cwd, source: 'cli' } }) + '\n'), body]);
  const hash = input => createHash('sha256').update(input).digest('hex');
  const pkg = { schemaVersion: 1, threadId, timestamp, cwd, title: 'Fixture', bytes: bytes.length, sha256: hash(bytes), bodySha256: hash(body), base64: bytes.toString('base64') };
  return { target, native, adapter, expected, pkg, changeIdentity: () => { identity = randomUUID(); } };
}

test('local preparation passes the normalized project snapshot to the actual native receipt adapter', async t => {
  const f = await fixture(t);
  const { operationId } = await f.adapter.conversationPrepare({ path: f.target, expected: f.expected, package: f.pkg, note: 'next' });
  const saved = await f.native.describe({ operationId });
  assert.deepEqual(saved.expected, { path: f.target, head: f.expected.head, branch: 'main', sharedProjectId: f.expected.sharedProjectId });
  assert.equal(saved.applyAuthorized, false);
  const service = new ConversationContinuationService({ localAdapter: f.adapter, localDevice: { id: 'target', name: 'Target' }, peers: [] });
  assert.deepEqual((await service.conversationOperations({ deviceId: 'target' })).operations, []);
  const stateFile = path.join(f.native.receiptRoot, operationId, 'state.json');
  const state = JSON.parse(await fs.readFile(stateFile, 'utf8'));
  await fs.writeFile(stateFile, JSON.stringify({ ...state, applyAuthorized: true }));
  const records = (await service.conversationOperations({ deviceId: 'target' })).operations;
  assert.equal(records.length, 1); assert.equal(records[0].status, 'prepared');
  assert.equal(records[0].operationId, operationId); assert.equal(records[0].resumeEligible, true);
});

test('target cannot replace a saved snapshot with a newly supplied version or association', async t => {
  for (const mode of ['commit', 'identity', 'caller']) {
    const f = await fixture(t);
    const { operationId } = await f.adapter.conversationPrepare({ path: f.target, expected: f.expected, package: f.pkg });
    if (mode === 'commit') {
      await fs.writeFile(path.join(f.target, 'tracked'), 'changed'); await git(f.target, ['add', 'tracked']);
      await git(f.target, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'changed']);
    }
    if (mode === 'identity') f.changeIdentity();
    const supplied = mode === 'caller' ? { ...f.expected, head: 'b'.repeat(40) } : await f.adapter.inspect({ path: f.target });
    await assert.rejects(f.adapter.conversationApply({ operationId, expected: supplied }), /变化/);
    assert.equal((await f.native.describe({ operationId })).applyAuthorized, false);
  }
});
