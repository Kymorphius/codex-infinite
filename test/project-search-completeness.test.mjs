import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NewProjectService } from '../src/new-project-service.mjs';
import { readProjectSearchThreads } from '../src/project-search-threads.mjs';
import { buildProjectSearchCatalog } from '../src/project-search.mjs';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('search reads all native pages independently of recent activity and retains complete data on failure', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'search-complete-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const threads = Array.from({ length: 235 }, (_, n) => ({ id: id(n), name: `会话 ${n}`, cwd: '/old', projectId: 'p' }));
  let now = Date.now(), fail = false, calls = 0;
  const service = new NewProjectService({ statePath: path.join(dir, 'state.json'), clock: () => now,
    taskAdapter: { listTasks: async () => ({ tasks: [] }) }, logger: { warn() {} },
    clientFactory: () => ({ initialize: async () => {}, close() {}, async request(method, params) {
      if (method === 'project/list') return { data: [{ id: 'p', name: '项目', position: 0, roots: [{ path: '/current' }] }] };
      calls++;
      assert.equal(params.archived, false); assert.deepEqual(params.sourceKinds, []);
      if (fail && params.cursor) throw Error('offline');
      const start = Number(params.cursor || 0);
      return { data: threads.slice(start, start + 100), nextCursor: start + 100 < threads.length ? String(start + 100) : null };
    } }) });
  const first = await service.readSearch();
  assert.equal(first.stale, false); assert.equal(first.projects[0].tasks.length, 235);
  assert.equal(first.projects[0].tasks.at(-1).id, id(234)); assert.equal(calls, 3);
  await service.readSearch(); assert.equal(calls, 3);
  fail = true; now += 60_001;
  const stale = await service.readSearch();
  assert.equal(stale.stale, true); assert.deepEqual(stale.projects, first.projects);
});
test('native thread reader rejects invalid and repeated pages', async () => {
  await assert.rejects(readProjectSearchThreads({ request: async () => ({ data: [], nextCursor: 'repeat' }) }), /repeated/);
  await assert.rejects(readProjectSearchThreads({ request: async () => ({}) }), /invalid/);
});
test('valid explicit ownership wins while stale or missing ownership uses directory', () => {
  const ordered = ['a', 'b'].map(id => ({ project: { id, name: id } }));
  const tasks = [{ id: id(1), projectId: 'b' }, { id: id(2) }, { id: id(2) }, { id: id(3), archived: true }, { id: id(4), projectId: 'deleted' }];
  const result = buildProjectSearchCatalog(ordered, tasks, () => ({ id: 'a' }));
  assert.deepEqual(result.map(p => p.tasks.map(t => t.id)), [[id(2), id(4)], [id(1)]]);
});
