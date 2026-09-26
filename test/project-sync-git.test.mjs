import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { LocalProjectSyncAdapter } from '../src/local-project-sync-adapter.mjs';

const run = (root, ...args) => execFileSync('git', ['-c', 'user.name=Sync Test', '-c', 'user.email=sync@example.invalid', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

async function fixture(t) {
  const parent = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'project-sync-test-')));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const source = path.join(parent, 'source');
  const target = path.join(parent, 'target');
  await fs.mkdir(source);
  run(source, 'init', '--initial-branch=main');
  await fs.writeFile(path.join(source, '.gitignore'), 'device.local\ncache/\n');
  await fs.writeFile(path.join(source, 'app.txt'), 'one\n');
  run(source, 'add', '.gitignore', 'app.txt');
  run(source, 'commit', '-m', 'initial');
  run(parent, 'clone', source, target);
  let projects = [{ path: source, name: 'Source' }, { path: target, name: 'Target' }];
  let tasks = [];
  let time = Date.now();
  const adapter = new LocalProjectSyncAdapter({ projectProvider: async () => projects, taskProvider: async () => tasks, now: () => time });
  const commit = async (root, value, file = 'app.txt') => {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), value);
    run(root, 'add', '--', file);
    run(root, 'commit', '-m', 'change');
  };
  const prepare = async (from = source, to = target) => adapter.prepare({ path: to, expected: await adapter.inspect({ path: to }), package: await adapter.export({ path: from, expected: await adapter.inspect({ path: from }) }) });
  return { adapter, parent, source, target, commit, prepare, setTasks: value => { tasks = value; }, setProjects: value => { projects = value; }, advance: value => { time += value; } };
}

test('fast-forward synchronizes in both directions and verifies unchanged state', async t => {
  const f = await fixture(t);
  await f.commit(f.source, 'two\n');
  const before = run(f.target, 'rev-parse', 'HEAD');
  const plan = await f.prepare();
  assert.equal(plan.unchanged, false);
  assert.equal(run(f.target, 'rev-parse', 'HEAD'), before, 'prepare does not update target refs');
  assert.equal((await fs.readFile(path.join(f.target, 'app.txt'), 'utf8')).replaceAll('\r\n', '\n'), 'one\n');
  const result = await f.adapter.apply({ token: plan.token });
  assert.equal(result.verified, true);
  assert.equal(result.target.head, run(f.source, 'rev-parse', 'HEAD'));
  assert.equal((await fs.readFile(path.join(f.target, 'app.txt'), 'utf8')).replaceAll('\r\n', '\n'), 'two\n');
  await assert.rejects(f.adapter.apply({ token: plan.token }), { code: 'PREFLIGHT_EXPIRED' });
  await f.commit(f.target, 'three\n');
  assert.equal((await f.adapter.apply({ token: (await f.prepare(f.target, f.source)).token })).verified, true);
  const unchanged = await f.prepare();
  assert.equal(unchanged.unchanged, true);
  assert.equal((await f.adapter.apply({ token: unchanged.token })).unchanged, true);
});

test('target config, ignored device files and hooks are preserved without executing hooks', async t => {
  const f = await fixture(t);
  const hookMarker = path.join(f.parent, 'hook-ran');
  await fs.writeFile(path.join(f.target, '.git', 'hooks', 'post-merge'), `#!/bin/sh\ntouch '${hookMarker}'\n`, { mode: 0o755 });
  run(f.target, 'config', 'project.device', 'target-device');
  await fs.writeFile(path.join(f.target, 'device.local'), 'target private data\n');
  const config = await fs.readFile(path.join(f.target, '.git', 'config'), 'utf8');
  await f.commit(f.source, 'update\n');
  await f.adapter.apply({ token: (await f.prepare()).token });
  assert.equal(await fs.readFile(path.join(f.target, '.git', 'config'), 'utf8'), config);
  assert.equal(await fs.readFile(path.join(f.target, 'device.local'), 'utf8'), 'target private data\n');
  assert.equal(await fs.stat(hookMarker).then(() => true, () => false), false);
});

test('target branch squash defaults cannot replace the requested fast-forward operation', async t => {
  const f = await fixture(t);
  run(f.target, 'config', 'branch.main.mergeOptions', '--squash');
  const config = await fs.readFile(path.join(f.target, '.git', 'config'), 'utf8');
  await f.commit(f.source, 'second\n');
  const result = await f.adapter.apply({ token: (await f.prepare()).token });
  assert.equal(result.target.head, run(f.source, 'rev-parse', 'HEAD'));
  assert.equal(result.target.clean, true);
  assert.equal(run(f.target, 'status', '--porcelain'), '');
  assert.equal(await fs.readFile(path.join(f.target, '.git', 'config'), 'utf8'), config);
});

test('divergent, unrelated, target-ahead and different-branch projects are blocked', async t => {
  const f = await fixture(t);
  await f.commit(f.source, 'source\n');
  await f.commit(f.target, 'target\n');
  await assert.rejects(f.prepare(), { code: 'NOT_FAST_FORWARD' });
  run(f.target, 'switch', '-c', 'other');
  await assert.rejects(f.prepare(), { code: 'BRANCH_MISMATCH' });
  run(f.target, 'switch', 'main');
  run(f.target, 'checkout', '--orphan', 'unrelated');
  run(f.target, 'commit', '-m', 'unrelated');
  run(f.target, 'branch', '-D', 'main');
  run(f.target, 'branch', '-m', 'main');
  await assert.rejects(f.prepare(), { code: 'NOT_FAST_FORWARD' });
  const g = await fixture(t);
  await g.commit(g.target, 'target ahead\n');
  await assert.rejects(g.prepare(), { code: 'NOT_FAST_FORWARD' });
});

test('tracked, untracked and hidden index modifications block inspection', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.source, 'app.txt'), 'dirty\n');
  await assert.rejects(f.adapter.inspect({ path: f.source }), { code: 'DIRTY_PROJECT' });
  run(f.source, 'restore', 'app.txt');
  await fs.writeFile(path.join(f.source, 'new.txt'), 'untracked\n');
  await assert.rejects(f.adapter.inspect({ path: f.source }), { code: 'DIRTY_PROJECT' });
  await fs.rm(path.join(f.source, 'new.txt'));
  run(f.source, 'update-index', '--assume-unchanged', 'app.txt');
  await assert.rejects(f.adapter.inspect({ path: f.source }), { code: 'DIRTY_PROJECT' });
});

test('changed snapshots, expiry, repeated execution and revoked registration invalidate preflight', async t => {
  const f = await fixture(t);
  const old = await f.adapter.inspect({ path: f.source });
  await f.commit(f.source, 'second\n');
  await assert.rejects(f.adapter.export({ path: f.source, expected: old }), { code: 'PROJECT_CHANGED' });
  const changed = await f.prepare();
  await f.commit(f.target, 'new target\n');
  await assert.rejects(f.adapter.apply({ token: changed.token }), { code: 'PROJECT_CHANGED' });
  await assert.rejects(f.adapter.apply({ token: changed.token }), { code: 'PREFLIGHT_EXPIRED' });
  const g = await fixture(t);
  const expired = await g.prepare();
  g.advance(10 * 60 * 1000);
  await assert.rejects(g.adapter.apply({ token: expired.token }), { code: 'PREFLIGHT_EXPIRED' });
  const revoked = await g.prepare();
  g.setProjects([{ path: g.source, name: 'source' }]);
  await assert.rejects(g.adapter.apply({ token: revoked.token }), { code: 'PROJECT_NOT_REGISTERED' });
});

test('ignored path collisions are rejected at preparation and again immediately before apply', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.source, 'device.local'), 'tracked source content\n');
  run(f.source, 'add', '--force', 'device.local');
  run(f.source, 'commit', '-m', 'track new file');
  await fs.writeFile(path.join(f.target, 'device.local'), 'keep target content\n');
  await assert.rejects(f.prepare(), { code: 'IGNORED_FILE_COLLISION' });
  assert.equal(await fs.readFile(path.join(f.target, 'device.local'), 'utf8'), 'keep target content\n');
  await fs.rm(path.join(f.target, 'device.local'));
  const plan = await f.prepare();
  await fs.writeFile(path.join(f.target, 'device.local'), 'created after preview\n');
  await assert.rejects(f.adapter.apply({ token: plan.token }), { code: 'IGNORED_FILE_COLLISION' });
  assert.equal(await fs.readFile(path.join(f.target, 'device.local'), 'utf8'), 'created after preview\n');
});

test('overlapping active and unknown tasks block roots and nested paths', async t => {
  const f = await fixture(t);
  for (const cwd of [f.source, path.join(f.source, 'src'), f.parent]) {
    f.setTasks([{ cwd, status: 'active' }]);
    await assert.rejects(f.adapter.inspect({ path: f.source }), { code: 'PROJECT_BUSY' });
  }
  f.setTasks([{ cwd: f.source, status: 'unknown' }]);
  await assert.rejects(f.adapter.inspect({ path: f.source }), { code: 'PROJECT_BUSY' });
  f.setTasks([{ status: 'active' }]);
  await assert.rejects(f.adapter.inspect({ path: f.source }), { code: 'TASK_STATUS_UNAVAILABLE' });
  f.setTasks([{ cwd: f.target, status: 'active' }, { cwd: f.source, status: 'completed' }]);
  assert.equal((await f.adapter.inspect({ path: f.source })).clean, true);
});

test('preflight count is bounded and expiry frees capacity', async t => {
  const f = await fixture(t);
  const plans = [];
  for (let index = 0; index < 8; index += 1) plans.push(await f.prepare());
  await assert.rejects(f.prepare(), { code: 'TOO_MANY_PREFLIGHTS' });
  f.advance(10 * 60 * 1000);
  const fresh = await f.prepare();
  await f.adapter.apply({ token: fresh.token });
});
