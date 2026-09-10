import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { rekeyNativeHistoryRecord, CloneRecordTransform } from '../src/project-clone-records.mjs';
import { rekeyCloneMetadata, hasOnlyInheritedHistory } from '../src/project-clone-history.mjs';
import { upgradeCloneHistoryReferences } from '../src/project-clone-history-upgrade.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

test('transport identity patch preserves nested data, whitespace, and message bytes', () => {
  const oldId = randomUUID(), newId = randomUUID();
  const line = Buffer.from(`{ "type" : "event_msg", "payload" : {"item":{"thread_id":"${oldId}","text":"中文 \\"thread_id\\":\\"${oldId}\\""}, "thread_id" : "${oldId}"}}\n`);
  const expected = Buffer.from(line.toString().replace(`"thread_id" : "${oldId}"`, `"thread_id" : "${newId}"`));
  assert.deepEqual(rekeyNativeHistoryRecord(line, { [oldId]: newId }), expected);
  const data = Buffer.from(JSON.stringify({ type: 'response_item', payload: { thread_id: oldId, output: oldId } }));
  assert.equal(rekeyNativeHistoryRecord(data, { [oldId]: newId }), data);
});
test('record transform handles byte boundaries without changing textual references', async () => {
  const oldId = randomUUID(), newId = randomUUID();
  const header = Buffer.from('{"type":"session_meta"}\n');
  const body = Buffer.from(JSON.stringify({ type: 'token_usage_record', payload: { thread_id: oldId, note: oldId } }) + '\n');
  const expected = Buffer.from(body.toString().replace(`"thread_id":"${oldId}"`, `"thread_id":"${newId}"`));
  const transform = new CloneRecordTransform({ [oldId]: newId });
  Readable.from([...Buffer.concat([header, body])].map(byte => Buffer.from([byte]))).pipe(transform);
  const chunks = []; for await (const chunk of transform) chunks.push(chunk);
  assert.deepEqual(Buffer.concat(chunks), Buffer.concat([header, expected]));
  assert.equal(transform.bodyHash.digest('hex'), sha(expected));
});
test('v2 children retain their mapped shared session identity', () => {
  const parent = randomUUID(), child = randomUUID(), localParent = randomUUID(), localChild = randomUUID();
  const record = { type: 'session_meta', payload: { id: child, session_id: parent, thread_source: 'subagent', source: { subagent: { thread_spawn: { parent_thread_id: parent } } } } };
  const next = rekeyCloneMetadata(record, { sourceThreadId: child, localThreadId: localChild, cwd: '/root', idMap: { [parent]: localParent, [child]: localChild } });
  assert.equal(next.payload.session_id, localParent);
  assert.equal(next.payload.id, localChild);
  assert.equal(next.payload.thread_source, 'subagent');
});
test('upgrade journal recovers an atomic replacement before the outer receipt was saved', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'clone-upgrade-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const oldId = randomUUID(), localThreadId = randomUUID(), cwd = '/root';
  const body = Buffer.from(JSON.stringify({ type: 'event_msg', payload: { type: 'item_completed', thread_id: oldId, item: { content: oldId } } }) + '\n');
  const filePath = path.join(directory, 'rollout.jsonl');
  await fs.writeFile(filePath, Buffer.concat([Buffer.from(JSON.stringify({ type: 'session_meta', payload: { id: localThreadId, cwd } }) + '\n'), body]));
  const args = { filePath, localThreadId, cwd, bodySha256: sha(body), originalBodyBytes: body.length, idMap: { [oldId]: localThreadId } };
  const first = await upgradeCloneHistoryReferences(args), second = await upgradeCloneHistoryReferences(args);
  assert.equal(first.nativeBodySha256, second.nativeBodySha256);
  await fs.appendFile(filePath, 'tamper');
  await assert.rejects(upgradeCloneHistoryReferences(args));
});

test('an inherited-only fork is distinguished from missing paginated content', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'clone-inherited-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'rollout.jsonl');
  const header = { type: 'session_meta', payload: { id: randomUUID(), history_mode: 'paginated', subagent_history_start_ordinal: 460 } };
  await fs.writeFile(file, JSON.stringify(header) + '\n' + JSON.stringify({ ordinal: 459, type: 'event_msg', payload: {} }) + '\n');
  assert.equal(await hasOnlyInheritedHistory(file), true);
  await fs.appendFile(file, JSON.stringify({ ordinal: 460, type: 'event_msg', payload: {} }) + '\n');
  assert.equal(await hasOnlyInheritedHistory(file), false);
});
