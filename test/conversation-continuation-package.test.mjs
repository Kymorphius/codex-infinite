import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { exportContinuation, validateContinuationPackage } from '../src/conversation-continuation-package.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const row = value => `${JSON.stringify(value)}\n`;
function packet(content, { threadId, title = '继续工作', cwd, timestamp = '2026-09-30T04:00:00Z' }) {
  const bytes = Buffer.from(content), offset = bytes.indexOf(10) + 1;
  return { schemaVersion: 1, threadId, title, cwd, timestamp, sha256: hash(bytes), bodySha256: hash(bytes.subarray(offset)), bytes: bytes.length, base64: bytes.toString('base64') };
}
async function fixture(t, { nested = false, archived = false } = {}) {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'continuation-source-')));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'project'), sessionRoot = path.join(directory, 'sessions'), archiveRoot = path.join(directory, 'archived_sessions');
  await Promise.all([fs.mkdir(root), fs.mkdir(sessionRoot), fs.mkdir(archiveRoot)]);
  const cwd = nested ? path.join(root, 'nested') : root;
  if (nested) await fs.mkdir(cwd);
  const threadId = randomUUID(), sourceFile = path.join(archived ? archiveRoot : sessionRoot, `${threadId}.jsonl`), timestamp = '2026-09-30T04:00:00Z';
  const metadata = { type: 'session_meta', payload: { id: threadId, session_id: threadId, cwd, timestamp, source: 'cli' } };
  const body = row({ type: 'event_msg', payload: { type: 'task_complete', thread_id: threadId } })
    + row({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '已完成中文历史' }], phase: 'final' } });
  const content = row(metadata) + body;
  await fs.writeFile(sourceFile, content);
  const task = { id: threadId, title: '继续工作', status: 'completed', cwd, sourceFile, isSubagent: false, archived };
  const args = { threadId, root, sessionRoots: [sessionRoot, archiveRoot], taskProvider: async () => [{ ...task }], taskReader: async () => ({ ...task }) };
  return { directory, root, cwd, sessionRoot, archiveRoot, threadId, sourceFile, metadata, body, content, task, args, timestamp };
}
const fails = (promise, code, pattern) => assert.rejects(promise, error => error.statusCode === code && pattern.test(error.message));

test('exports complete bytes for a stopped main session, including nested and archived roots', async t => {
  for (const options of [{}, { nested: true }, { archived: true }]) {
    const value = await fixture(t, options), pkg = await exportContinuation(value.args);
    assert.deepEqual(pkg, packet(value.content, value));
    assert.deepEqual(validateContinuationPackage({ ...pkg, ignored: true }), pkg);
    assert.equal(Buffer.from(pkg.base64, 'base64').toString(), value.content);
    assert.equal((await fs.readFile(value.sourceFile, 'utf8')), value.content);
  }
});

test('requires a known terminal state and rejects missing, active, unknown or subagent sessions', async t => {
  const value = await fixture(t);
  for (const status of ['idle', 'completed', 'interrupted', 'error', 'cancelled']) {
    value.task.status = status;
    assert.equal((await exportContinuation(value.args)).threadId, value.threadId);
  }
  for (const status of ['active', 'unknown', 'archived', undefined]) {
    value.task.status = status;
    await fails(exportContinuation(value.args), 409, /已结束/);
  }
  value.task.status = 'completed'; value.task.isSubagent = true;
  await fails(exportContinuation(value.args), 409, /主会话/);
  value.task.isSubagent = false;
  await fails(exportContinuation({ ...value.args, taskProvider: async () => [] }), 409, /不可读取/);
  await fails(exportContinuation({ ...value.args, taskProvider: async () => [value.task, value.task] }), 409, /不可读取/);
  await fails(exportContinuation({ ...value.args, taskProvider: async () => { throw new Error('private'); } }), 503, /原生会话状态/);
});

test('canonical cwd membership refuses another project and prefix lookalikes', async t => {
  const value = await fixture(t);
  const other = path.join(value.directory, 'project-other'); await fs.mkdir(other);
  value.task.cwd = other;
  await fails(exportContinuation(value.args), 409, /不属于/);
  value.task.cwd = value.cwd;
  const alias = path.join(value.directory, 'project-alias');
  try { await fs.symlink(other, alias, 'junction'); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) return; throw error; }
  value.task.cwd = alias;
  await fails(exportContinuation(value.args), 409, /不属于/);
});

test('refuses a symlink source, an escaped real file and an escaping directory alias', async t => {
  const value = await fixture(t), outside = path.join(value.directory, 'outside'); await fs.mkdir(outside);
  const foreign = path.join(outside, 'foreign.jsonl'); await fs.writeFile(foreign, value.content);
  value.task.sourceFile = foreign;
  await fails(exportContinuation(value.args), 403, /读取目录/);
  const link = path.join(value.sessionRoot, 'linked.jsonl');
  try { await fs.symlink(foreign, link); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) return; throw error; }
  value.task.sourceFile = link;
  await fails(exportContinuation(value.args), 403, /符号链接/);
  const directoryLink = path.join(value.sessionRoot, 'escape'); await fs.symlink(outside, directoryLink, 'junction');
  value.task.sourceFile = path.join(directoryLink, 'foreign.jsonl');
  await fails(exportContinuation(value.args), 403, /读取目录/);
});

test('strict metadata identity and graph references reject foreign dependencies without scanning chat text', async t => {
  const value = await fixture(t), other = randomUUID();
  const variations = [
    { ...value.metadata, payload: { ...value.metadata.payload, id: other } },
    { ...value.metadata, payload: { ...value.metadata.payload, session_id: other } },
    { ...value.metadata, payload: { ...value.metadata.payload, parent_thread_id: other } },
    { ...value.metadata, payload: { ...value.metadata.payload, forked_from_id: other } },
    { ...value.metadata, payload: { ...value.metadata.payload, source: { subagent: { thread_spawn: { parent_thread_id: other } } } } }
  ];
  for (const metadata of variations) {
    await fs.writeFile(value.sourceFile, row(metadata) + value.body);
    await fails(exportContinuation(value.args), 409, /标识|会话|迁移/);
  }
  for (const fields of [{ thread_id: other }, { session_id: other }, { parent_id: other }, { senderThreadId: other }, { receiver_thread_ids: [value.threadId, other] }]) {
    const content = row(value.metadata) + row({ type: 'event_msg', payload: { type: 'collaboration', ...fields } });
    assert.throws(() => validateContinuationPackage(packet(content, value)), error => error.statusCode === 409);
  }
  const content = row(value.metadata) + row({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ text: `请检查 thread_id ${other} 和 parent_id ${other}` }] } });
  assert.equal(validateContinuationPackage(packet(content, value)).sha256, hash(Buffer.from(content)));
});

test('refuses identities in unsupported record locations, corrupt JSON and duplicate metadata', async t => {
  const value = await fixture(t);
  for (const record of [
    { type: 'event_msg', payload: { type: 'custom', nested: { thread_id: value.threadId } } },
    { type: 'response_item', payload: { type: 'message', thread_id: value.threadId } },
    { type: 'event_msg', payload: { type: 'custom', session_id: value.threadId } },
    value.metadata
  ]) {
    assert.throws(() => validateContinuationPackage(packet(row(value.metadata) + row(record), value)), error => error.statusCode === 409);
  }
  assert.throws(() => validateContinuationPackage(packet(row(value.metadata) + '{unfinished', value)), error => error.statusCode === 400);
  assert.throws(() => validateContinuationPackage(packet(JSON.stringify(value.metadata), value)), error => error.statusCode === 400);
});

test('rechecks task state, task reader source and file hashes after the first read', async t => {
  const value = await fixture(t);
  let reads = 0;
  await fails(exportContinuation({ ...value.args, taskProvider: async () => [{ ...value.task, status: ++reads === 1 ? 'completed' : 'active' }] }), 409, /已结束/);
  reads = 0;
  await fails(exportContinuation({ ...value.args, taskReader: async () => ({ ...value.task, sourceFile: ++reads === 1 ? value.sourceFile : path.join(value.sessionRoot, 'moved.jsonl') }) }), 409, /变化/);
  reads = 0;
  await fails(exportContinuation({ ...value.args, taskProvider: async () => {
    if (++reads === 2) await fs.writeFile(value.sourceFile, value.content.replace('已完成中文历史', '被替换中文历史'));
    return [{ ...value.task }];
  } }), 409, /变化/);
});

test('rejects oversized sources and malformed transport encoding, size, hashes and metadata', async t => {
  const value = await fixture(t), pkg = await exportContinuation(value.args);
  for (const changes of [
    { schemaVersion: 2 }, { bytes: 0 }, { bytes: pkg.bytes + 1 }, { base64: `${pkg.base64}\n` },
    { sha256: '0'.repeat(64) }, { bodySha256: '0'.repeat(64) }, { cwd: `${value.cwd}-other` },
    { timestamp: '2026-09-30T05:00:00Z' }, { threadId: randomUUID() }, { title: '' }
  ]) assert.throws(() => validateContinuationPackage({ ...pkg, ...changes }), error => [400, 409].includes(error.statusCode));
  assert.throws(() => validateContinuationPackage({ ...pkg, bytes: 8 * 1024 * 1024 + 1 }), error => error.statusCode === 413);
  await fs.truncate(value.sourceFile, 8 * 1024 * 1024 + 1);
  await fails(exportContinuation(value.args), 413, /8 MiB/);
});

test('incoming packets accept native Windows absolute paths on a POSIX receiver', () => {
  const threadId = randomUUID(), cwd = 'C:\\Users\\Admin\\project', timestamp = '2026-09-30T04:00:00Z';
  const content = row({ type: 'session_meta', payload: { id: threadId, cwd, timestamp, source: 'cli' } })
    + row({ type: 'token_usage_record', payload: { thread_id: threadId, usage: 100 } });
  assert.equal(validateContinuationPackage(packet(content, { threadId, cwd, timestamp })).cwd, cwd);
});

test('accepts a valid maximum-size history without exhausting the base64 validator stack', () => {
  const threadId = randomUUID(), cwd = '/fixture', timestamp = '2026-09-30T04:00:00Z';
  const header = row({ type: 'session_meta', payload: { id: threadId, cwd, timestamp, source: 'cli' } });
  const record = text => row({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } });
  const content = header + record('x'.repeat(8 * 1024 * 1024 - Buffer.byteLength(header + record(''))));
  const pkg = packet(content, { threadId, cwd, timestamp });
  assert.equal(pkg.bytes, 8 * 1024 * 1024);
  assert.equal(validateContinuationPackage(pkg).sha256, pkg.sha256);
});
