import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SentMessageIndex } from '../src/sent-message-index.mjs';
import { SentMessageSearchService } from '../src/sent-message-search-service.mjs';

async function untilReady(index) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (index.progress.ready) return;
    if (index.failed) throw new Error('index worker failed');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('index did not become ready');
}

test('local FTS index builds once, includes appended sent text and removes archived sessions', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sent-index-'));
  const file = path.join(root, 'thread.jsonl');
  const databasePath = path.join(root, 'index.sqlite');
  const line = (role, body) => JSON.stringify({ timestamp: new Date().toISOString(), type: 'response_item',
    payload: { type: 'message', role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text: body }] } }) + '\n';
  await fs.writeFile(file, line('assistant', 'Private assistant marker') + line('user', 'Find ＮＥＥＤＬＥ here'));
  const index = new SentMessageIndex({ databasePath, sessionRoots: [root] });
  let archived = false;
  const catalog = { async snapshot() { return { truncated: false, conversations: [{ id: 'one', title: 'One', transcriptPath: file, archived }] }; } };
  const service = new SentMessageSearchService({ catalog, index });
  try {
    await service.prepare();
    await untilReady(index);
    const first = (await service.search('needle')).items[0];
    assert.equal(first.id, 'one');
    assert.match(first.excerpt, /ＮＥＥＤＬＥ/);
    assert.deepEqual((await service.search('assistant marker')).items, []);
    await fs.appendFile(file, line('user', 'Later project update'));
    index.sync((await catalog.snapshot()).conversations, { force: true });
    await untilReady(index);
    assert.equal((await service.search('project')).items[0].id, 'one');
    archived = true;
    index.sync([], { force: true });
    await untilReady(index);
    assert.deepEqual((await service.search('needle')).items, []);
    assert.equal((await fs.stat(databasePath)).mode & 0o777, 0o600);
  } finally { await index.close(); await fs.rm(root, { recursive: true, force: true }); }
});
