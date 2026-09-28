import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { LocalProjectIdentityAdapter } from '../src/local-project-identity-adapter.mjs';
import { ProjectIdentityStore } from '../src/project-identity-store.mjs';

test('real checkout association survives restart without changing code or config; unlink tolerates dirty files', async t => {
  const parent = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'project-identity-git-')));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const root = path.join(parent, 'project'); await fs.mkdir(root);
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Identity Test', '-c', 'user.email=identity@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main'); await fs.writeFile(path.join(root, 'app.txt'), 'hello\n'); git('add', 'app.txt'); git('commit', '-m', 'initial');
  const config = await fs.readFile(path.join(root, '.git/config'));
  const filePath = path.join(parent, 'state', 'identities.json');
  let tasks = [], registered = true;
  const make = () => new LocalProjectIdentityAdapter({ identityStore: new ProjectIdentityStore({ filePath }),
    projectProvider: async () => registered ? [{ path: root, name: 'Project' }] : [], taskProvider: async () => tasks });
  const a = make(), expected = await a.inspect({ path: root }), projectId = randomUUID();
  tasks = [{ cwd: root, status: 'active' }];
  await assert.rejects(a.associate({ path: root, expected, projectId })); tasks = [];
  await a.associate({ path: root, expected, projectId });
  const restart = make();
  assert.equal((await restart.catalog()).projects[0].sharedProjectId, projectId);
  assert.equal(git('rev-parse', 'HEAD'), expected.head); assert.equal(git('status', '--porcelain'), '');
  assert.deepEqual(await fs.readFile(path.join(root, '.git/config')), config);
  await assert.rejects(restart.associate({ path: root, expected, projectId: randomUUID() }), /关联已变化/);
  const associated = await restart.inspect({ path: root });
  await assert.rejects(restart.associate({ path: root, expected: associated, projectId: randomUUID() }), /不能覆盖/);
  await fs.writeFile(path.join(root, 'app.txt'), 'unsaved progress\n');
  registered = false;
  await assert.rejects(restart.dissociate({ path: root, projectId })); registered = true;
  await restart.dissociate({ path: root, projectId });
  assert.equal((await restart.catalog()).projects[0].sharedProjectId, null);
  assert.equal(await fs.readFile(path.join(root, 'app.txt'), 'utf8'), 'unsaved progress\n');
});
