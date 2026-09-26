import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TerminalConversationStore } from '../src/terminal-conversation-store.mjs';

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'terminal-registry-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'registry.json');
  return { filePath, directory, store: new TerminalConversationStore({ filePath, deviceId: 'owner' }) };
}
const input = { cwd: '/project', kind: 'shell', title: 'Shell', projectRef: null };

test('atomic registry persists all concurrent creates and leaves no temporary files', async t => {
  const { store, filePath, directory } = await fixture(t);
  const records = await Promise.all(Array.from({ length: 12 }, (_, i) => store.create({ ...input, title: String(i) })));
  assert.equal(new Set(records.map(record => record.id)).size, 12);
  assert.equal((await new TerminalConversationStore({ filePath, deviceId: 'owner' }).list()).length, 12);
  assert.deepEqual(await fs.readdir(directory), ['registry.json']);
  const list = await store.list(); list[0].title = 'external mutation';
  assert.notEqual((await store.get(list[0].id)).title, 'external mutation');
});

test('corrupt or foreign-device registry fails closed without overwriting original bytes', async t => {
  const { filePath } = await fixture(t);
  for (const content of ['not json', JSON.stringify({ version: 1, deviceId: 'other', conversations: [] }),
    JSON.stringify({ version: 99, deviceId: 'owner', conversations: [] })]) {
    await fs.writeFile(filePath, content);
    const store = new TerminalConversationStore({ filePath, deviceId: 'owner' });
    await assert.rejects(store.list(), { statusCode: 503 });
    await assert.rejects(store.create(input), { statusCode: 503 });
    assert.equal(await fs.readFile(filePath, 'utf8'), content);
  }
});

test('failed atomic write does not publish unpersisted metadata or block a later retry', async t => {
  const { store, directory } = await fixture(t);
  const original = store.filePath; store.filePath = directory;
  // Initialize the empty store first so this specifically exercises rename failure.
  store.ready = Promise.resolve();
  await assert.rejects(store.create(input)); assert.deepEqual(await store.list(), []);
  store.filePath = original;
  const created = await store.create(input); assert.equal((await store.list())[0].id, created.id);
  assert.deepEqual(await fs.readdir(directory), ['registry.json']);
});
