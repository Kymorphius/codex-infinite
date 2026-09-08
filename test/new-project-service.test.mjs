import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NewProjectService } from '../src/new-project-service.mjs';
import { NEW_PROJECT_WEEK_MS } from '../src/new-project-policy.mjs';
const initial = Date.parse('2026-09-05T10:00:00Z');
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'new-projects-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const calls = [];
  const data = { now: initial, fail: false, tasks: [], projects: [{ id: 'new', name: '新', position: 0, createdAt: initial / 1000 - 60, roots: [{ path: '/new' }] }] };
  const options = { statePath: path.join(dir, 'lifecycle.json'), clock: () => data.now,
    taskAdapter: { listTasks: async () => ({ tasks: data.tasks }) }, logger: { warn() {} },
    clientFactory: () => ({ initialize: async () => {}, close: () => calls.push('close'), request: async (method, params) => {
      calls.push(method);
      if (data.fail) throw Error('offline');
      return params.cursor ? { data: data.projects.slice(1) } : { data: data.projects.slice(0, 1), nextCursor: 'second' };
    } }) };
  return { data, calls, options, service: new NewProjectService(options) };
}
test('reads all pages once per cache period, coalesces, returns only normalized UI fields', async t => {
  const f = await fixture(t);
  f.data.projects.push({ ...f.data.projects[0], id: 'second', name: '第二个' });
  const results = await Promise.all([f.service.read(), f.service.read()]);
  assert.deepEqual(results[0].map(p => p.id), ['new', 'second']);
  assert.equal(f.calls.filter(c => c === 'project/list').length, 2);
  assert.equal(JSON.stringify(results).includes('/new'), false);
  await f.service.read();
  assert.equal(f.calls.length, 3);
  assert.deepEqual(f.calls, ['project/list', 'project/list', 'close']);
});
test('top-ten graduation persists through restart and later no-score state', async t => {
  const f = await fixture(t);
  f.data.tasks = [{ id: '01a04cd6-8d30-78f1-b2a7-f760d148f744', cwd: '/new', title: '工作', createdAt: new Date(initial).toISOString() }];
  assert.deepEqual(await f.service.read(), []);
  const stored = JSON.parse(await fs.readFile(f.options.statePath, 'utf8'));
  assert.equal(stored.lifecycle.new.reason, 'top-ten');
  f.data.tasks = [];
  assert.deepEqual(await new NewProjectService(f.options).read(), []);
});
test('failed refresh retains unexpired snapshot only and retries without graduating from missing data', async t => {
  const f = await fixture(t);
  assert.equal((await f.service.read()).length, 1);
  f.data.now += 60_001; f.data.fail = true;
  assert.equal((await f.service.read()).length, 1);
  f.data.now += NEW_PROJECT_WEEK_MS;
  assert.deepEqual(await f.service.read(), []);
  await assert.rejects(fs.readFile(f.options.statePath), { code: 'ENOENT' });
});
test('corrupt persistence fails closed and is preserved', async t => {
  const f = await fixture(t);
  await fs.writeFile(f.options.statePath, 'broken');
  assert.deepEqual(await f.service.read(), []);
  assert.equal(await fs.readFile(f.options.statePath, 'utf8'), 'broken');
});
test('persistence failure does not publish uncommitted graduation', async t => {
  const f = await fixture(t);
  assert.equal((await f.service.read()).length, 1);
  await fs.mkdir(f.options.statePath);
  f.data.now += 60_001;
  f.data.tasks = [{ cwd: '/new', createdAt: new Date(initial).toISOString() }];
  assert.equal((await f.service.read()).length, 1);
});
test('migration registration does not make an old legacy project new', async t => {
  const f = await fixture(t);
  const statePath = path.join(path.dirname(f.options.statePath), 'native-state.json');
  await fs.writeFile(statePath, JSON.stringify({
    'local-projects': { original: { createdAt: initial - 2 * NEW_PROJECT_WEEK_MS } },
    'app-server-project-id-by-legacy-project-id-by-host': { 'local:/home': { original: 'new' } }
  }));
  const service = new NewProjectService({ ...f.options, projectStatePaths: [statePath] });
  assert.deepEqual(await service.read(), []);
  assert.equal(JSON.parse(await fs.readFile(f.options.statePath)).lifecycle.new.reason, 'one-week');
});
