import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { RecentSentConversationService } from '../src/recent-sent-conversation-service.mjs';
import { CodexTaskAdapter } from '../src/task-adapter.mjs';

const id = n => `12345678-1234-1234-1234-${String(n).padStart(12, '0')}`;
const date = n => new Date(Date.UTC(2026, 8, 1, 0, n)).toISOString();
const task = n => ({ id: id(n), title: `任务 ${n}`, sourceFile: `/sessions/${n}.jsonl`, updatedAt: date(99 - n) });
const settle = async service => { service.read(); await service.pending; return service.read(); };

test('read is nonblocking, does not scan tasks, and caps index concurrency at two', async () => {
  const tasks = Array.from({ length: 8 }, (_, i) => task(i));
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  let active = 0; let maxActive = 0; let calls = 0;
  const service = new RecentSentConversationService({
    taskAdapter: { getCachedTasks: () => tasks, listTasks: () => assert.fail('Must not rescan task directory') },
    index: { read: async file => {
      calls += 1; active += 1; maxActive = Math.max(maxActive, active);
      await barrier;
      active -= 1;
      return { lastUserMessageAt: date(Number(path.basename(file, '.jsonl'))), complete: true };
    } }
  });
  const initial = service.read();
  assert.deepEqual(initial, { items: [], loading: true, stale: false });
  assert.equal(calls, 2);
  assert.equal(service.read().loading, true);
  release();
  await service.pending;
  const result = service.read();
  assert.equal(result.loading, false);
  assert.equal(result.stale, false);
  assert.equal(maxActive, 2);
  assert.equal(calls, 8);
  assert.deepEqual(result.items.map(item => item.id), tasks.map(item => item.id).reverse());
  assert.ok(result.items.every(item => Object.keys(item).sort().join(',') === 'id,kind,lastUserMessageAt,status,title'));
  assert.ok(result.items.every(item => item.status === 'unknown'));
});

test('filters archives, subagents and invalid IDs, deduplicates, limits and sorts actual message times', async () => {
  const tasks = Array.from({ length: 45 }, (_, i) => task(i));
  tasks.push({ ...task(44), title: '重复任务' }, { ...task(90), sourceFile: '/archive/90.jsonl' },
    { ...task(91), isSubagent: true }, { ...task(92), archived: true }, { ...task(93), id: 'invalid' });
  const scanned = [];
  const service = new RecentSentConversationService({
    archivedSessionRoot: '/archive', taskAdapter: { getCachedTasks: () => tasks },
    index: { read: async file => {
      scanned.push(file);
      return { lastUserMessageAt: date(Number(path.basename(file, '.jsonl'))), complete: true };
    } }
  });
  const result = await settle(service);
  assert.equal(result.items.length, 40);
  assert.deepEqual(result.items.map(item => item.id), Array.from({ length: 40 }, (_, i) => id(44 - i)));
  assert.equal(scanned.length, 46);
  result.items[0].title = 'mutated';
  assert.notEqual(service.read().items[0].title, 'mutated');
});

test('recent sent snapshot carries the cached native task status without inferring it from send time', async () => {
  const service = new RecentSentConversationService({ taskAdapter: { getCachedTasks: () => [{ ...task(1), status: 'active' }] },
    index: { read: async () => ({ lastUserMessageAt: date(1), complete: true }) } });
  assert.equal((await settle(service)).items[0].status, 'active');
});

test('failures and uncertain records retain previous results with a visible stale flag', async () => {
  let now = 0; let failure = false;
  const service = new RecentSentConversationService({ clock: () => now, taskAdapter: { getCachedTasks: () => [task(1), task(2)] },
    index: { read: async file => {
      if (failure && file.endsWith('1.jsonl')) throw new Error('read failed');
      return { lastUserMessageAt: date(2), complete: !failure };
    } }
  });
  const initial = await settle(service);
  failure = true; now = 5001;
  const failed = await settle(service);
  assert.deepEqual(failed.items, initial.items);
  assert.equal(failed.stale, true);
  failure = false; now = 10002;
  assert.equal((await settle(service)).stale, false);
});

test('cold task cache stays loading until existing indexing supplies a snapshot', async () => {
  let tasks = null; let now = 0;
  const service = new RecentSentConversationService({ clock: () => now, taskAdapter: { getCachedTasks: () => tasks } });
  assert.deepEqual(await settle(service), { items: [], loading: true, stale: false });
  tasks = []; now = 5001;
  assert.deepEqual(await settle(service), { items: [], loading: false, stale: false });
});

test('cold partial transcripts retain verified sends without inventing timestamps', async () => {
  const service = new RecentSentConversationService({ taskAdapter: { getCachedTasks: () => [task(1), task(2)] },
    index: { read: async file => ({ complete: false, lastUserMessageAt: file.endsWith('1.jsonl') ? date(1) : null }) } });
  const result = await settle(service);
  assert.equal(result.stale, true);
  assert.deepEqual(result.items.map(item => [item.id, item.lastUserMessageAt]), [[id(1), date(1)]]);
});

test('unchanged background refresh never toggles loading or changes the published snapshot', async () => {
  let now = 0; let release;
  const result = { lastUserMessageAt: date(1), complete: true };
  let read = async () => result;
  const service = new RecentSentConversationService({ clock: () => now,
    taskAdapter: { getCachedTasks: () => [task(1)] }, index: { read: (...args) => read(...args) } });
  const initial = await settle(service);
  read = () => new Promise(resolve => { release = () => resolve(result); });
  now = 5001;
  assert.deepEqual(service.read(), initial);
  assert.deepEqual(service.read(), initial);
  release();
  await service.pending;
  assert.deepEqual(service.read(), initial);
});

test('successful refresh removes no-longer-eligible sessions and index cache entries', async () => {
  let tasks = [task(1)]; let now = 0; let retained;
  const service = new RecentSentConversationService({ clock: () => now, taskAdapter: { getCachedTasks: () => tasks },
    index: { read: async () => ({ lastUserMessageAt: date(1), complete: true }), retain: paths => { retained = paths; } }
  });
  assert.equal((await settle(service)).items.length, 1);
  tasks = [{ ...task(1), isSubagent: true }]; now = 5001;
  assert.deepEqual((await settle(service)).items, []);
  assert.deepEqual(retained, []);
});

test('task adapter cached getter performs no I/O and returns detached task records', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'recent-sent-adapter-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const adapter = new CodexTaskAdapter({ sessionRoot: directory });
  assert.equal(adapter.getCachedTasks(), null);
  await adapter.listTasks();
  assert.deepEqual(adapter.getCachedTasks(), []);
  adapter.taskIndex.set(id(1), task(1));
  const cached = adapter.getCachedTasks();
  cached[0].title = 'mutation';
  assert.equal(adapter.getCachedTasks()[0].title, task(1).title);
  assert.equal(adapter.listing, null);
});
