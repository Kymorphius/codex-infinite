import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { projectGptMessage, readGptTranscript } from '../src/gpt-context-transcript.mjs';

function message(id, role = 'user', text = '消息 ' + id, phase) {
  return { type: 'response_item', timestamp: '2026-09-09T00:00:00Z',
    payload: { type: 'message', id: String(id), role, phase, content: [{ type: 'input_text', text }] } };
}
async function fixture(t, records) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gpt-history-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'history.jsonl');
  await fs.writeFile(file, records.map(record => JSON.stringify(record)).join('\n') + '\n');
  return file;
}

test('only public user/final messages are returned; commentary is opt-in', () => {
  for (const role of ['system', 'developer', 'tool']) assert.equal(projectGptMessage(message('x', role, 'private'), 0), null);
  assert.equal(projectGptMessage(message('x', 'assistant', 'secret reasoning', 'analysis'), 0), null);
  assert.equal(projectGptMessage({ type: 'response_item', payload: { type: 'reasoning', text: 'private' } }, 0), null);
  assert.equal(projectGptMessage(message('x', 'assistant', 'progress', 'commentary'), 0), null);
  assert.equal(projectGptMessage(message('x', 'assistant', 'progress', 'commentary'), 0, { includeCommentary: true }).text, 'progress');
  assert.equal(projectGptMessage(message('x', 'assistant', 'answer', 'final_answer'), 10).byteOffset, 10);
  assert.equal(projectGptMessage(message('x', 'user', '<environment_context>machine</environment_context>\n实际问题'), 0).text, '实际问题');
  assert.equal(projectGptMessage(message('x', 'user', '# AGENTS.md instructions for /work\nsecret rules'), 0), null);
  assert.equal(projectGptMessage(message('x', 'user', '<recommended_plugins>list</recommended_plugins>'), 0), null);
  assert.match(projectGptMessage(message('x', 'user', 'sk-proj-' + 'A'.repeat(40)), 0).text, /REDACTED/);
});

test('backwards pagination retains every UTF-8 message exactly once at byte boundaries', async t => {
  const records = Array.from({ length: 40 }, (_, n) => message(n, n % 2 ? 'assistant' : 'user', `中文🌍${n}`, n % 2 ? 'final' : undefined));
  const file = await fixture(t, records), ids = [];
  let cursor, pages = 0;
  do {
    const page = await readGptTranscript(file, { conversationId: 'test', cursor, limit: 3, windowBytes: 650, maxScanBytes: 1600 });
    ids.unshift(...page.messages.map(x => x.id));
    cursor = page.olderCursor;
    assert.equal(page.messages.some(x => x.text.includes('�')), false);
    assert.ok(++pages < 50);
  } while (cursor);
  assert.deepEqual(ids, records.map(x => x.payload.id));
});

test('bounded search returns a continuation even when a recent page has no match', async t => {
  const records = [message('target', 'user', 'Hermes 与 Multica'), ...Array.from({ length: 40 }, (_, n) => message(n))];
  const file = await fixture(t, records);
  let page = await readGptTranscript(file, { conversationId: 'test', query: 'HERMES', windowBytes: 600, maxScanBytes: 1200 });
  assert.equal(page.messages.length, 0); assert.ok(page.olderCursor);
  let count = 0;
  while (page.olderCursor && page.messages.length === 0) {
    page = await readGptTranscript(file, { conversationId: 'test', query: 'HERMES', cursor: page.olderCursor, windowBytes: 600, maxScanBytes: 1200 });
    assert.ok(++count < 20);
  }
  assert.equal(page.messages[0].id, 'target');
});

test('cursor is bound to file, conversation and query; appends preserve an older snapshot', async t => {
  const file = await fixture(t, Array.from({ length: 10 }, (_, n) => message(n)));
  const page = await readGptTranscript(file, { conversationId: 'a', limit: 2 });
  await fs.appendFile(file, JSON.stringify(message('new')) + '\n');
  const next = await readGptTranscript(file, { conversationId: 'a', cursor: page.olderCursor, limit: 2 });
  assert.deepEqual(next.messages.map(x => x.id), ['6', '7']);
  assert.equal(next.snapshotBytes, page.snapshotBytes);
  await assert.rejects(readGptTranscript(file, { conversationId: 'b', cursor: page.olderCursor }), /游标/);
  await assert.rejects(readGptTranscript(file, { conversationId: 'a', query: 'other', cursor: page.olderCursor }), /游标/);
  await fs.rename(file, file + '.old'); await fs.writeFile(file, '{}\n');
  await assert.rejects(readGptTranscript(file, { conversationId: 'a', cursor: page.olderCursor }), /游标/);
});

test('large non-message records and unfinished writes remain bounded and explicit', async t => {
  const file = await fixture(t, [message('before'), { type: 'response_item', payload: { type: 'function_call_output', output: 'X'.repeat(6000) } }, message('after')]);
  await fs.appendFile(file, '{"incomplete":');
  const first = await readGptTranscript(file, { conversationId: 'test', windowBytes: 1000, maxScanBytes: 2500 });
  assert.equal(first.messages[0].id, 'after'); assert.ok(first.hasOlder);
  assert.ok(first.skippedRecords > 0); assert.ok(first.scannedBytes <= 2500);
  const trimmed = projectGptMessage(message('long', 'user', 'x'.repeat(3000) + 'NEEDLE' + 'x'.repeat(3000)), 0, { query: 'needle', maxMessageChars: 500 });
  assert.ok(trimmed.truncated); assert.ok(trimmed.text.includes('NEEDLE'));
});
