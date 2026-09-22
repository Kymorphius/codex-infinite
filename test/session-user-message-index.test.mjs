import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { SessionUserMessageIndex } from '../src/session-user-message-index.mjs';

const date = day => `2026-09-${String(day).padStart(2, '0')}T12:00:00.000Z`;
const user = (day, message = '实际输入') => ({ timestamp: date(day), type: 'event_msg', payload: { type: 'user_message', message } });
const assistant = (day, text = '回复') => ({ timestamp: date(day), type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] } });
const jsonl = records => records.map(JSON.stringify).join('\n') + '\n';
async function fixture(t, records = []) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'recent-sent-index-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'session.jsonl');
  await fs.writeFile(file, jsonl(records));
  return file;
}

test('uses actual user timestamps and excludes assistant, tools, injected blocks and delegation', async t => {
  const response = { timestamp: date(3), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '用户输入' }] } };
  const metadata = structuredClone(response);
  metadata.timestamp = date(9);
  metadata.payload.internal_chat_message_metadata_passthrough = { content_item_kinds: ['environments.environment_context'] };
  const file = await fixture(t, [user(1), response, response, metadata, assistant(10),
    user(11, '# AGENTS.md instructions for /project'), user(12, '<environment_context>机器配置</environment_context>'),
    user(13, '<codex_delegation><source_thread_id>12345678-1234-1234-1234-123456789abc</source_thread_id><input>委派任务</input></codex_delegation>'),
    { timestamp: date(14), type: 'response_item', payload: { type: 'function_call_output', output: '工具结果' } }]);
  assert.deepEqual(await new SessionUserMessageIndex().read(file), { lastUserMessageAt: date(3), complete: true });
});

test('append is incremental, unfinished UTF-8 records resume and unchanged reads do not reopen', async t => {
  const file = await fixture(t, [user(1)]);
  let opens = 0;
  let bytes = 0;
  const index = new SessionUserMessageIndex({ chunkBytes: 1024, fsImpl: {
    stat: (...args) => fs.stat(...args),
    open: async (...args) => {
      opens += 1;
      const handle = await fs.open(...args);
      return {
        read: async (...readArgs) => { const result = await handle.read(...readArgs); bytes += result.bytesRead; return result; },
        stat: () => handle.stat(), close: () => handle.close()
      };
    }
  } });
  assert.equal((await index.read(file)).lastUserMessageAt, date(1));
  const initialBytes = bytes;
  const same = await index.read(file);
  same.lastUserMessageAt = 'not shared';
  assert.equal(opens, 1);
  assert.equal(bytes, initialBytes);
  assert.equal((await index.read(file)).lastUserMessageAt, date(1));
  const record = Buffer.from(jsonl([user(4, '中文消息'.repeat(700))]));
  await fs.appendFile(file, record.subarray(0, 1100));
  assert.deepEqual(await index.read(file), { lastUserMessageAt: date(1), complete: false });
  await fs.appendFile(file, record.subarray(1100));
  assert.deepEqual(await index.read(file), { lastUserMessageAt: date(4), complete: true });
  assert.ok(bytes - initialBytes < record.length + 2000);
  assert.ok([...index.cache.values()].every(value => !JSON.stringify(value).includes('中文消息')));
});

test('finds the newest user record in the middle of a greater-than-8MB log', async t => {
  const filler = assistant(20, 'x'.repeat(64 * 1024));
  const records = [user(1), ...Array(72).fill(filler), user(8), ...Array(72).fill(filler)];
  const file = await fixture(t, records);
  assert.ok((await fs.stat(file)).size > 8 * 1024 * 1024);
  assert.deepEqual(await new SessionUserMessageIndex().read(file), { lastUserMessageAt: date(8), complete: true });
});

test('rotation, truncation, same-size edits and changed append boundaries reset cached times', async t => {
  const file = await fixture(t, [user(8), assistant(9)]);
  const index = new SessionUserMessageIndex();
  assert.equal((await index.read(file)).lastUserMessageAt, date(8));
  await fs.writeFile(file, jsonl([user(2)]));
  assert.equal((await index.read(file)).lastUserMessageAt, date(2));
  await fs.writeFile(file, jsonl([user(3)]));
  assert.equal((await index.read(file)).lastUserMessageAt, date(3));
  await fs.writeFile(file, jsonl([user(1), assistant(2)]));
  assert.equal((await index.read(file)).lastUserMessageAt, date(1));
  await fs.rename(file, `${file}.old`);
  await fs.writeFile(file, jsonl([user(4)]));
  assert.deepEqual(await index.read(file), { lastUserMessageAt: date(4), complete: true });
});

test('malformed and oversized unknown records are explicitly incomplete, never apparently fresh', async t => {
  const file = await fixture(t, [user(1)]);
  const index = new SessionUserMessageIndex({ maxRecordBytes: 1024 });
  await fs.appendFile(file, jsonl([user(6, 'x'.repeat(4000)), assistant(10)]));
  assert.deepEqual(await index.read(file), { lastUserMessageAt: date(1), complete: false });
  await fs.writeFile(file, jsonl([user(1)]) + '{bad record}\n');
  assert.equal((await index.read(file)).complete, false);
  await fs.writeFile(file, jsonl([{ ...user(1), timestamp: 'invalid' }]));
  assert.deepEqual(await index.read(file), { lastUserMessageAt: null, complete: false });
  await fs.writeFile(file, jsonl([user(2)]));
  assert.deepEqual(await index.read(file), { lastUserMessageAt: date(2), complete: true });
});

test('oversized known assistant/tool records are skipped without mistaking message text for envelope fields', async t => {
  const file = await fixture(t, [user(2), assistant(8, '{"type":"user_message","role":"user"}'.repeat(300)),
    { timestamp: date(9), type: 'response_item', payload: { type: 'function_call_output', output: 'y'.repeat(7000) } }]);
  const index = new SessionUserMessageIndex({ maxRecordBytes: 1024, chunkBytes: 1024 });
  assert.deepEqual(await index.read(file), { lastUserMessageAt: date(2), complete: true });
  await fs.appendFile(file, jsonl([user(10, '{"type":"response_item","payload":{"type":"message","role":"assistant"}}'.repeat(100))]));
  assert.deepEqual(await index.read(file), { lastUserMessageAt: date(2), complete: false });
});

test('image-only native user sends count while explicit internal attachment records do not', async t => {
  const file = await fixture(t, [user(1),
    { ...user(3, ''), payload: { type: 'user_message', message: '', images: ['image'] } },
    { ...user(5, ''), payload: { type: 'user_message', message: '', local_images: ['/attachment'], internal_chat_message_metadata_passthrough: { content_item_kinds: ['user.image'] } } },
    { ...user(7, ''), payload: { type: 'user_message', message: '', images: ['injected'], internal_chat_message_metadata_passthrough: { content_item_kinds: ['environments.attachment'] } } }]);
  assert.deepEqual(await new SessionUserMessageIndex().read(file), { lastUserMessageAt: date(5), complete: true });
});

test('concurrent reads coalesce, missing files reject, and retain only keeps current metadata', async t => {
  const file = await fixture(t, [user(1)]);
  const index = new SessionUserMessageIndex();
  const first = index.read(file);
  assert.equal(index.read(file), first);
  await first;
  await assert.rejects(index.read(`${file}.missing`), { code: 'ENOENT' });
  assert.equal(index.pending.size, 0);
  index.retain([]);
  assert.equal(index.cache.size, 0);
});
