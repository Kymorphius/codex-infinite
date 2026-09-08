import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { projectAttentionConversations } from '../src/attention-conversations.mjs';
import { AttentionConversationService } from '../src/attention-conversation-service.mjs';
const id = '01a04cd6-8d30-78f1-b2a7-f760d148f744';
const second = '01a04cd6-8d30-78f1-b2a7-f760d148f745';
const task = { id, title: '检查结果', projectDisplayName: '项目甲', status: 'completed', updatedAt: '2026-09-05T10:00:00Z' };

test('review requires completed and unread; active takes precedence, read and archived disappear', () => {
  assert.equal(projectAttentionConversations([task], [id])[0].section, 'review');
  assert.deepEqual(projectAttentionConversations([task], []), []);
  assert.equal(projectAttentionConversations([{ ...task, status: 'active' }], [id])[0].section, 'active');
  for (const status of ['pending', 'error', 'interrupted']) assert.deepEqual(projectAttentionConversations([{ ...task, status }], [id]), []);
  assert.deepEqual(projectAttentionConversations([{ ...task, archived: true }], [id]), []);
});
test('normalizes safe display fields, deduplicates and orders most recent first without mutating membership', () => {
  const original = { ...task, cwd: '/private/path', projectId: 'original', section: '本周' };
  const result = projectAttentionConversations([original, original, { ...task, id: second, status: 'active', updatedAt: '2026-09-05T11:00:00Z' }], [id]);
  assert.deepEqual(result.map(item => item.id), [second, id]);
  assert.equal(original.section, '本周'); assert.equal(result[1].projectLabel, '项目甲');
  assert.equal(JSON.stringify(result).includes('/private'), false);
});
test('service coalesces reads, follows native read state, excludes archived paths and marks failed refresh stale', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'attention-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const statePath = path.join(dir, 'state.json'); let now = 100; let reads = 0;
  const write = unread => fs.writeFile(statePath, JSON.stringify({ 'electron-persisted-atom-state': { 'unread-thread-ids-by-host-v1': { local: unread } } }));
  await write([id, second]);
  const service = new AttentionConversationService({ statePath, archivedSessionRoot: path.join(dir, 'archive'), clock: () => now, taskAdapter: { listTasks: async () => {
    reads += 1; return { status: 'connected', tasks: [task, { ...task, id: second, sourceFile: path.join(dir, 'archive', 'old.jsonl') }] };
  } } });
  const snapshots = await Promise.all([service.read(), service.read()]);
  assert.equal(reads, 1); assert.deepEqual(snapshots[0].items.map(x => x.id), [id]);
  assert.equal(snapshots[0].stale, false);
  await fs.writeFile(statePath, 'bad'); now += 5001;
  assert.equal((await service.read()).stale, true); assert.equal((await service.read()).items.length, 1);
  await write([]); now += 5001;
  assert.deepEqual(await service.read(), { items: [], stale: false });
});
test('historical active markers require live confirmation and live completion can enter review', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'attention-runtime-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const statePath = path.join(dir, 'state.json');
  await fs.writeFile(statePath, JSON.stringify({ 'electron-persisted-atom-state': { 'unread-thread-ids-by-host-v1': { local: [second] } } }));
  const service = new AttentionConversationService({ statePath,
    taskAdapter: { listTasks: async () => ({ tasks: [{ ...task, status: 'active' }, { ...task, id: second, status: 'active' }] }) },
    runtimeStatusProvider: { readThreadStatuses: async () => new Map([[second, 'completed']]) }
  });
  const result = await service.read(); assert.deepEqual(result.items.map(x => [x.id, x.section]), [[second, 'review']]);
});

test('empty confirmed runtime is valid while a runtime failure preserves the last snapshot as stale', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'attention-empty-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const statePath = path.join(dir, 'state.json');
  await fs.writeFile(statePath, JSON.stringify({ 'electron-persisted-atom-state': { 'unread-thread-ids-by-host-v1': { local: [id] } } }));
  let failed = false;
  const service = new AttentionConversationService({ statePath, cacheMs: 0,
    taskAdapter: { listTasks: async () => ({ tasks: [task, { ...task, id: second, status: 'active' }] }) },
    runtimeStatusProvider: { readThreadStatuses: async options => {
      assert.equal(options.strict, true);
      if (failed) throw Error('disconnected');
      return new Map();
    } }
  });
  const result = await service.read(); assert.equal(result.stale, false);
  assert.deepEqual(result.items.map(x => [x.id, x.section]), [[id, 'review']]);
  failed = true; const stale = await service.read(); assert.equal(stale.stale, true); assert.deepEqual(stale.items, result.items);
});

test('native runtime strict reads distinguish an unloaded window from failed status retrieval', async () => {
  const { NativeConversationAdapter } = await import('../src/native-conversation-adapter.mjs');
  const adapter = new NativeConversationAdapter({});
  let value = []; let closed = 0;
  adapter.connect = async () => ({ evaluate: async () => value, close: async () => { closed += 1; } });
  assert.equal((await adapter.readThreadStatuses({ strict: true })).size, 0);
  value = undefined;
  await assert.rejects(adapter.readThreadStatuses({ strict: true }), /unavailable/);
  assert.equal((await adapter.readThreadStatuses()).size, 0);
  assert.equal(closed, 3);
});

test('primary native blue dots join wrapper unread state and disappear when their native source clears', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'attention-profiles-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const wrapper = path.join(dir, 'wrapper.json'), primary = path.join(dir, 'primary.json');
  const write = (file, local) => fs.writeFile(file, JSON.stringify({ 'electron-persisted-atom-state': { 'unread-thread-ids-by-host-v1': { local, remote: [second] } } }));
  await write(wrapper, []); await write(primary, [id, id, second]);
  const service = new AttentionConversationService({ statePath: wrapper, additionalStatePaths: [primary, wrapper], cacheMs: 0,
    taskAdapter: { listTasks: async () => ({ tasks: [task, { ...task, id: second, latestInputSource: 'codex' }] }) }
  });
  assert.equal(service.statePaths.length, 2);
  assert.deepEqual((await service.read()).items.map(x => [x.id, x.section]), [[id, 'review'], [second, 'codex']]);
  await write(primary, []);
  assert.deepEqual((await service.read()).items.map(x => x.section), ['codex']);
  await write(wrapper, [id]); await write(primary, [id]);
  assert.equal((await service.read()).items.length, 2);
  await write(wrapper, []);
  assert.equal((await service.read()).items.length, 2);
  await fs.writeFile(primary, 'invalid'); assert.equal((await service.read()).stale, true);
  await fs.rm(primary); assert.equal((await service.read()).stale, false);
  assert.deepEqual((await service.read()).items.map(x => x.section), ['codex']);
});
