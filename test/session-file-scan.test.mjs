import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionFileScan } from '../src/session-file-scan.mjs';
import { CodexTaskAdapter } from '../src/task-adapter.mjs';

function fixture() {
  let now = 1000, fail = false;
  const directories = new Map([['/sessions', ['day/']], ['/sessions/day', ['a.jsonl', 'b.jsonl']], ['/archived', ['c.jsonl']]]);
  const stats = new Map([['/sessions/day/a.jsonl', { mtimeMs: 3, size: 10, ino: 1, ctimeMs: 3 }],
    ['/sessions/day/b.jsonl', { mtimeMs: 2, size: 10, ino: 2, ctimeMs: 2 }], ['/archived/c.jsonl', { mtimeMs: 1, size: 10, ino: 3, ctimeMs: 1 }]]);
  const calls = { directory: 0, stat: 0 };
  const fsImpl = {
    async readdir(root) {
      calls.directory++;
      if (fail) throw new Error('temporary scan failure');
      if (!directories.has(root)) throw Object.assign(new Error('missing root'), { code: 'ENOENT' });
      return directories.get(root).map(name => ({ name: name.replace(/\/$/, ''), isDirectory: () => name.endsWith('/'), isFile: () => !name.endsWith('/') }));
    },
    async stat(filePath) { calls.stat++; const value = stats.get(filePath); if (!value) throw new Error('file vanished'); return { ...value }; }
  };
  return { fsImpl, calls, directories, stats, clock: () => now, advance(ms) { now += ms; }, fail(value) { fail = value; } };
}

test('session metadata reuses sequential and overlapping scans until its bounded TTL expires', async () => {
  const f = fixture(), scan = new SessionFileScan({ sessionRoot: '/sessions', archivedSessionRoot: '/archived', fsImpl: f.fsImpl, clock: f.clock });
  const values = await Promise.all(Array.from({ length: 6 }, () => scan.read()));
  assert.deepEqual(f.calls, { directory: 3, stat: 3 });
  assert.deepEqual(values[0].map(row => row.filePath), ['/sessions/day/a.jsonl', '/sessions/day/b.jsonl', '/archived/c.jsonl']);
  values[0][0].filePath = 'caller mutation'; values[1].pop();
  f.advance(249);
  assert.equal((await scan.read()).length, 3);
  assert.equal((await scan.read())[0].filePath, '/sessions/day/a.jsonl');
  assert.deepEqual(f.calls, { directory: 3, stat: 3 });
  f.advance(1); await scan.read();
  assert.deepEqual(f.calls, { directory: 6, stat: 6 });
});

test('expiry discovers new and archived files and drops removed paths', async () => {
  const f = fixture(), scan = new SessionFileScan({ sessionRoot: '/sessions', archivedSessionRoot: '/archived', fsImpl: f.fsImpl, clock: f.clock });
  await scan.read();
  f.directories.set('/sessions/day', ['b.jsonl', 'd.jsonl']);
  f.directories.set('/archived', ['c.jsonl', 'a.jsonl']);
  f.stats.set('/sessions/day/d.jsonl', { mtimeMs: 8, size: 20 });
  f.stats.set('/archived/a.jsonl', { mtimeMs: 3, size: 10 });
  assert.equal((await scan.read())[0].filePath, '/sessions/day/a.jsonl');
  f.advance(250);
  const paths = (await scan.read()).map(row => row.filePath);
  assert.deepEqual(paths, ['/sessions/day/d.jsonl', '/archived/a.jsonl', '/sessions/day/b.jsonl', '/archived/c.jsonl']);
  assert.equal(paths.includes('/sessions/day/a.jsonl'), false);
});

test('metadata failures and missing roots are not cached and TTL cannot exceed 500 ms', async () => {
  const f = fixture(), scan = new SessionFileScan({ sessionRoot: '/sessions', fsImpl: f.fsImpl, clock: f.clock, ttlMs: 10000 });
  await scan.read(); f.advance(500); f.fail(true);
  await assert.rejects(scan.read(), /temporary scan failure/);
  f.fail(false); assert.equal((await scan.read()).length, 2);
  assert.equal(f.calls.directory, 5, 'a failed scan retries immediately at the same clock time');
  const absent = new SessionFileScan({ sessionRoot: '/missing', fsImpl: f.fsImpl, clock: f.clock });
  await absent.read(); await absent.read();
  assert.equal(f.calls.directory, 7, 'missing directories must also be retried');
});

test('empty metadata scans expire and discover the first session', async () => {
  const f = fixture(); f.directories.set('/sessions', []);
  const scan = new SessionFileScan({ sessionRoot: '/sessions', fsImpl: f.fsImpl, clock: f.clock });
  assert.deepEqual(await scan.read(), []);
  f.directories.set('/sessions', ['first.jsonl']); f.stats.set('/sessions/first.jsonl', { mtimeMs: 9, size: 10 });
  assert.deepEqual(await scan.read(), []);
  f.advance(250); assert.equal((await scan.read())[0].filePath, '/sessions/first.jsonl');
});

test('task listings reuse metadata while runtime, title, settings, context and project enrichment stay fresh', async () => {
  const f = fixture(); f.directories.set('/sessions', ['a.jsonl']); f.stats.set('/sessions/a.jsonl', { mtimeMs: 1, size: 10 });
  const calls = { parse: 0, runtime: 0, title: 0, settings: 0, project: 0, relation: 0 };
  let status = 'active', title = '第一次标题', effort = 'low', context = 100, project = '第一次项目';
  const adapter = new CodexTaskAdapter({ sessionRoot: '/sessions', fsImpl: f.fsImpl, clock: f.clock,
    readTaskFileImpl: async filePath => { calls.parse++; return { id: 'a', sourceFile: filePath, title: '创建时标题', status: 'completed', cwd: '/demo', updatedAt: '2026-09-30T00:00:00Z' }; },
    runtimeStatusProvider: { async readThreadStatuses() { calls.runtime++; return new Map([['a', status]]); } },
    titleIndex: { async read() { calls.title++; return new Map([['a', title]]); } },
    sessionSettingsIndex: { async read() { calls.settings++; return { reasoningEffort: effort }; } },
    contextWindowStore: { get() { return { requestedContextWindow: context }; } },
    projectNameIndex: { async read() { calls.project++; return { nameFor: () => project }; } },
    threadProjectIndex: { async read() { calls.relation++; return { currentFor: () => null }; } }
  });
  const first = (await adapter.listTasks()).tasks[0];
  title = '第二次标题'; effort = 'high'; context = 200; project = '第二次项目';
  const second = (await adapter.listTasks()).tasks[0];
  assert.equal(first.title, '第一次标题'); assert.equal(second.title, '第二次标题');
  assert.equal(second.reasoningEffort, 'high'); assert.equal(second.requestedContextWindow, 200);
  assert.equal(second.projectDisplayName, '第二次项目');
  status = 'completed'; const third = (await adapter.listTasks()).tasks[0]; assert.equal(third.status, 'completed');
  assert.deepEqual(f.calls, { directory: 1, stat: 1 });
  assert.deepEqual(calls, { parse: 1, runtime: 3, title: 3, settings: 2, project: 3, relation: 3 });
});

test('task parse failure invalidates discovery so a corrected file retries without waiting for TTL', async () => {
  const f = fixture(); f.directories.set('/sessions', ['a.jsonl']); f.stats.set('/sessions/a.jsonl', { mtimeMs: 1, size: 10 });
  let fails = true;
  const adapter = new CodexTaskAdapter({ sessionRoot: '/sessions', fsImpl: f.fsImpl, clock: f.clock,
    readTaskFileImpl: async filePath => { if (fails) throw new Error('temporary session read failure'); return { id: 'a', sourceFile: filePath, title: '恢复的会话', status: 'completed', cwd: '/demo' }; } });
  assert.equal((await adapter.listTasks()).status, 'error'); fails = false;
  assert.equal((await adapter.listTasks()).tasks[0].title, '恢复的会话');
  assert.deepEqual(f.calls, { directory: 2, stat: 2 });
});

test('a file removed after discovery causes one failed listing then recovers immediately at the same clock', async () => {
  const f = fixture(); f.directories.set('/sessions', ['a.jsonl']); f.stats.set('/sessions/a.jsonl', { mtimeMs: 1, size: 10 });
  const adapter = new CodexTaskAdapter({ sessionRoot: '/sessions', fsImpl: f.fsImpl, clock: f.clock,
    readTaskFileImpl: async () => { throw Object.assign(new Error('file removed'), { code: 'ENOENT' }); } });
  await adapter.fileScan.read();
  f.directories.set('/sessions', []); f.stats.delete('/sessions/a.jsonl');
  assert.equal((await adapter.listTasks()).status, 'error');
  assert.equal((await adapter.listTasks()).status, 'empty');
  assert.deepEqual(f.calls, { directory: 2, stat: 1 });
});
