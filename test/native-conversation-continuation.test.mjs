import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { NativeConversationContinuation } from '../src/native-conversation-continuation.mjs';
import { readCloneMetadata } from '../src/project-clone-history.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(t, options = {}) {
  const created = await fs.mkdtemp(path.join(os.tmpdir(), 'continuation-native-'));
  const root = await fs.realpath(created);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const codexHome = path.join(root, 'home'), receiptRoot = path.join(root, 'operations'), target = path.join(root, 'project');
  await fs.mkdir(codexHome); await fs.mkdir(target);
  const threadId = randomUUID(), timestamp = '2026-09-30T00:00:00.000Z', cwd = '/foreign/project';
  const header = { type: 'session_meta', timestamp, payload: { id: threadId, timestamp, cwd, source: 'cli',
    originator: 'codex_cli_rs', cli_version: '0.131.0', instructions: null, model_provider: 'openai' } };
  const body = Buffer.from([
    { type: 'response_item', timestamp, payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '继续实现专用验收' }] } },
    { type: 'response_item', timestamp, payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '原历史' }] } },
    { type: 'event_msg', timestamp, payload: { type: 'item_completed', thread_id: threadId } }
  ].map(item => JSON.stringify(item)).join('\n') + '\n');
  const bytes = Buffer.concat([Buffer.from(JSON.stringify(header) + '\n'), body]);
  const pkg = { schemaVersion: 1, threadId, timestamp, cwd, title: '专用会话验收', bytes: bytes.length,
    sha256: hash(bytes), bodySha256: hash(body), base64: bytes.toString('base64') };
  const projectId = randomUUID(), threads = new Map(), requests = [];
  let closed = 0, initialized = 0, operationId;
  const clone = async () => JSON.parse(await fs.readFile(path.join(receiptRoot, operationId, 'clone.json')));
  const clientFactory = () => ({
    initialize: async () => { initialized++; }, close: () => { closed++; },
    request: async (method, params) => {
      requests.push({ method, params });
      if (method === 'project/list') return { data: options.projects || [{ id: projectId, roots: [{ path: target }] }], nextCursor: null };
      if (method === 'thread/read') {
        const item = (await clone()).sessions[0];
        if (!threads.has(item.localThreadId)) threads.set(item.localThreadId, { id: item.localThreadId, path: item.path,
          cwd: options.initialCwd || target, projectId: null });
        return { thread: { ...threads.get(item.localThreadId) } };
      }
      if (method === 'thread/turns/list') return { data: options.emptyHistory ? [] : [{ id: 'history-turn' }] };
      if (method === 'thread/settings/update') threads.get(params.threadId).cwd = params.cwd;
      if (method === 'thread/metadata/update') {
        threads.get(params.threadId).projectId = params.projectId;
        await options.holdMetadata?.();
        if (options.failMetadata) { options.failMetadata = false; throw new Error('登记请求超时'); }
      }
      if (['thread/name/set', 'thread/resume', 'thread/unsubscribe', 'thread/settings/update', 'thread/metadata/update'].includes(method)) return { cwd: params.cwd };
      throw new Error(`Unexpected method: ${method}`);
    }
  });
  const adapter = new NativeConversationContinuation({ codexPath: '/unused', codexHome, receiptRoot, clientFactory });
  const prepare = async (note = '下一步检查验收') => {
    const result = await adapter.prepare({ package: pkg, path: target, note });
    operationId = result.operationId; return result;
  };
  return { root, codexHome, receiptRoot, target, pkg, bytes, projectId, threads, requests, adapter, prepare, clone,
    counts: () => ({ closed, initialized }), state: () => fs.readFile(path.join(receiptRoot, operationId, 'state.json'), 'utf8').then(JSON.parse) };
}

test('continuation imports one independently identified history into an existing project without starting work', async t => {
  const f = await fixture(t, { initialCwd: '/incorrect' });
  const prepared = await f.prepare();
  assert.equal(prepared.threadId, f.pkg.threadId);
  const description = await f.adapter.describe({ operationId: prepared.operationId });
  assert.equal(description.path, f.target); assert.equal(description.sha256, f.pkg.sha256);
  assert.equal('base64' in description, false);
  const result = await f.adapter.execute({ operationId: prepared.operationId, expectedPath: f.target });
  assert.equal(result.verified, true); assert.equal(result.projectId, f.projectId);
  assert.notEqual(result.targetThreadId, f.pkg.threadId); assert.equal(result.note, '下一步检查验收');
  const receipt = await f.clone(), item = receipt.sessions[0];
  assert.equal(receipt.sessions.length, 1); assert.equal(item.localThreadId, result.targetThreadId);
  const metadata = await readCloneMetadata(item.path);
  assert.equal(metadata.record.payload.cwd, f.target); assert.equal(metadata.record.payload.id, result.targetThreadId);
  const content = await fs.readFile(item.path, 'utf8');
  assert.match(content, /原历史/); assert.match(content, new RegExp(result.targetThreadId));
  assert.equal(content.includes(f.pkg.threadId), false);
  assert.deepEqual(await fs.readFile(path.join(f.receiptRoot, prepared.operationId, 'staged', 'source.jsonl')), f.bytes);
  assert.deepEqual(f.counts(), { closed: 1, initialized: 1 });
  assert.equal((await f.state()).status, 'completed');
  assert.equal(f.requests.filter(item => item.method === 'thread/settings/update').length, 1);
  assert.equal(f.requests.some(item => ['project/import', 'turn/start', 'thread/delete'].includes(item.method)), false);
});

test('missing and ambiguous native projects fail before writing a cloned session', async t => {
  for (const ambiguous of [false, true]) {
    const f = await fixture(t);
    const other = randomUUID();
    const projects = ambiguous ? [{ id: other, roots: [{ path: f.target }] }, { id: randomUUID(), roots: [{ path: f.target }] }] : [];
    f.adapter.clientFactory = () => ({ initialize: async () => {}, close: () => {}, request: async method => {
      assert.equal(method, 'project/list'); return { data: projects };
    } });
    const { operationId } = await f.prepare();
    const result = await f.adapter.execute({ operationId });
    assert.equal(result.verified, false); assert.match(result.message, /唯一已登记/);
    await assert.rejects(fs.stat(path.join(f.codexHome, 'sessions')), { code: 'ENOENT' });
    await assert.rejects(f.clone(), { code: 'ENOENT' });
    assert.equal((await f.state()).status, 'needs-review');
  }
});

test('uncertain native metadata write retains the same clone and explicit recovery does not repeat confirmed changes', async t => {
  const f = await fixture(t, { failMetadata: true });
  const { operationId } = await f.prepare();
  const first = await f.adapter.execute({ operationId });
  assert.equal(first.verified, false); assert.equal((await f.state()).status, 'needs-review');
  const item = (await f.clone()).sessions[0];
  const copied = await fs.readFile(item.path);
  const initialRequests = f.requests.length;
  const recovered = await f.adapter.resume({ operationId, expectedPath: f.target });
  assert.equal(recovered.verified, true); assert.equal(recovered.targetThreadId, item.localThreadId);
  assert.deepEqual(await fs.readFile(item.path), copied);
  assert.deepEqual(f.requests.slice(initialRequests).map(item => item.method), ['project/list', 'thread/read', 'thread/read', 'thread/turns/list']);
  assert.equal(f.requests.filter(item => item.method === 'thread/metadata/update').length, 1);
  assert.deepEqual(f.counts(), { closed: 2, initialized: 2 });
});

test('completed recovery reads appended user history without cloning or mutating the conversation', async t => {
  const f = await fixture(t), { operationId } = await f.prepare();
  const first = await f.adapter.execute({ operationId }), item = (await f.clone()).sessions[0];
  await fs.appendFile(item.path, JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '验收后继续的新消息' }] } }) + '\n');
  const before = await fs.readFile(item.path), count = f.requests.length;
  const again = await f.adapter.resume({ operationId });
  assert.equal(again.verified, true); assert.equal(again.targetThreadId, first.targetThreadId);
  assert.deepEqual(await fs.readFile(item.path), before);
  assert.deepEqual(f.requests.slice(count).map(item => item.method), ['project/list', 'thread/read', 'thread/turns/list']);
  assert.equal((await fs.readdir(path.dirname(item.path))).filter(name => name.endsWith('.jsonl')).length, 1);
});

test('completed receipts retain their completion guard after a failed readback and never rebind user changes', async t => {
  const f = await fixture(t), { operationId } = await f.prepare();
  const result = await f.adapter.execute({ operationId });
  f.threads.get(result.targetThreadId).projectId = randomUUID();
  const count = f.requests.length;
  assert.equal((await f.adapter.resume({ operationId })).verified, false);
  assert.ok((await f.state()).completedAt);
  f.threads.get(result.targetThreadId).projectId = f.projectId;
  assert.equal((await f.adapter.resume({ operationId })).verified, true);
  assert.equal(f.requests.slice(count).some(item => ['thread/metadata/update', 'thread/resume', 'thread/settings/update'].includes(item.method)), false);
});

test('operation IDs, target mismatch, package checksums and immutable manifests fail closed', async t => {
  const f = await fixture(t);
  await assert.rejects(f.adapter.describe({ operationId: '../escape' }), /标识/);
  await assert.rejects(f.adapter.prepare({ package: { ...f.pkg, sha256: '0'.repeat(64) }, path: f.target }), /校验|checksum|哈希/i);
  const { operationId } = await f.prepare();
  await assert.rejects(f.adapter.execute({ operationId, expectedPath: f.root }), /目录已变化/);
  assert.equal(f.requests.length, 0);
  const manifestFile = path.join(f.receiptRoot, operationId, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestFile)); manifest.sessions[0].isProjectThread = false;
  await fs.writeFile(manifestFile, JSON.stringify(manifest));
  await assert.rejects(f.adapter.resume({ operationId }), /清单已变化/);
  assert.equal(f.requests.length, 0);
});

test('tampered retained history and symlinked output directories cannot write native clones', async t => {
  const f = await fixture(t), { operationId } = await f.prepare();
  const staged = path.join(f.receiptRoot, operationId, 'staged', 'source.jsonl');
  await fs.appendFile(staged, 'tampered');
  const changed = await f.adapter.execute({ operationId });
  assert.equal(changed.verified, false); assert.match(changed.message, /历史已变化/);
  await fs.writeFile(staged, f.bytes);
  const sessions = path.join(f.codexHome, 'sessions'), other = path.join(f.root, 'outside');
  await fs.mkdir(other); await fs.symlink(other, path.join(sessions, '2026'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await f.adapter.resume({ operationId })).verified, false);
  assert.deepEqual(await fs.readdir(other), []);
  assert.equal(f.requests.some(item => item.method.startsWith('thread/')), false);
});

test('pending-operation quota and per-operation concurrency prevent duplicate imports', async t => {
  const f = await fixture(t);
  await fs.mkdir(f.receiptRoot);
  for (let index = 0; index < 32; index++) {
    const id = randomUUID(), root = path.join(f.receiptRoot, id); await fs.mkdir(root);
    await fs.writeFile(path.join(root, 'state.json'), JSON.stringify({ operationId: id, status: 'prepared' }));
  }
  await assert.rejects(f.prepare(), /待处理会话副本过多/);
  await fs.rm(f.receiptRoot, { recursive: true });
  let unblock, started;
  const entered = new Promise(resolve => { started = resolve; });
  const blocked = new Promise(resolve => { unblock = resolve; });
  const g = await fixture(t, { holdMetadata: async () => { started(); await blocked; } });
  const { operationId } = await g.prepare();
  const run = g.adapter.execute({ operationId }); await entered;
  await assert.rejects(g.adapter.resume({ operationId }), /正在进行/);
  unblock(); assert.equal((await run).verified, true);
  assert.equal(g.requests.filter(item => item.method === 'thread/name/set').length, 1);
});

test('only confirmed execution becomes a recoverable operation and preserves the expected Git snapshot', async t => {
  const f = await fixture(t, { failMetadata: true });
  const expected = { path: f.target, head: 'a'.repeat(40), branch: 'main', sharedProjectId: randomUUID() };
  const prepared = await f.adapter.prepare({ package: f.pkg, path: f.target, expected });
  assert.deepEqual((await f.adapter.describe({ operationId: prepared.operationId })).expected, expected);
  assert.deepEqual(await f.adapter.operations(), []);
  const denied = await f.adapter.resume({ operationId: prepared.operationId });
  assert.equal(denied.verified, false); assert.match(denied.message, /尚未确认执行/);
  assert.equal(f.requests.length, 0);
  await assert.rejects(fs.stat(path.join(f.codexHome, 'sessions')), { code: 'ENOENT' });
  const { operationId } = await f.prepare();
  assert.equal((await f.adapter.execute({ operationId })).verified, false);
  const records = await f.adapter.operations();
  assert.equal(records.length, 1); assert.equal(records[0].operationId, operationId);
  assert.equal('base64' in records[0], false); assert.equal('expected' in records[0], false);
});

test('configured wrapper session alias is supported only when it resolves to the configured source session root', async t => {
  const f = await fixture(t), sourceSessions = path.join(f.root, 'source-sessions');
  await fs.mkdir(sourceSessions);
  await fs.symlink(sourceSessions, path.join(f.codexHome, 'sessions'), process.platform === 'win32' ? 'junction' : 'dir');
  f.adapter.sessionRoot = sourceSessions;
  const { operationId } = await f.prepare();
  const success = await f.adapter.execute({ operationId });
  assert.equal(success.verified, true);
  const item = (await f.clone()).sessions[0];
  assert.ok((await fs.realpath(item.path)).startsWith(sourceSessions + path.sep));
  const unrelated = path.join(f.root, 'unrelated'); await fs.mkdir(unrelated);
  f.adapter.sessionRoot = unrelated;
  const before = f.requests.length;
  assert.equal((await f.adapter.resume({ operationId })).verified, false);
  assert.deepEqual(f.requests.slice(before).map(item => item.method), ['project/list']);
  assert.deepEqual(await fs.readdir(unrelated), []);
});

test('expired unconfirmed preflights release the quota and cannot authorize later native writes', async t => {
  const f = await fixture(t);
  await fs.mkdir(f.receiptRoot);
  for (let index = 0; index < 32; index++) {
    const id = randomUUID(), root = path.join(f.receiptRoot, id); await fs.mkdir(root);
    await fs.writeFile(path.join(root, 'state.json'), JSON.stringify({ operationId: id, status: 'prepared', applyAuthorized: false, expiresAt: Date.now() - 1 }));
  }
  const { operationId } = await f.prepare();
  const file = path.join(f.receiptRoot, operationId, 'prepared.json');
  const prepared = JSON.parse(await fs.readFile(file));
  prepared.preparedAt = Date.now() - 600001; prepared.expiresAt = prepared.preparedAt + 600000;
  await fs.writeFile(file, JSON.stringify(prepared));
  const result = await f.adapter.execute({ operationId });
  assert.equal(result.verified, false); assert.match(result.message, /预检已过期/);
  assert.equal(f.requests.length, 0); assert.equal((await f.state()).applyAuthorized, false);
});
