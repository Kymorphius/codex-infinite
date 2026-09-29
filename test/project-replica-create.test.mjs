import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { LocalProjectReplicaAdapter } from '../src/local-project-replica-adapter.mjs';
import { ProjectReplicaService } from '../src/project-replica-service.mjs';

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'replica-test-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'), parent = path.join(root, 'copies');
  await fs.mkdir(source); await fs.mkdir(parent);
  const git = (...args) => execFileSync('git', ['-C', source, ...args], { stdio: 'pipe' }).toString().trim();
  git('init', '-b', 'main'); git('config', 'user.email', 'fixture@example.test'); git('config', 'user.name', 'Fixture');
  await fs.writeFile(path.join(source, '.gitignore'), 'private.txt\n'); await fs.writeFile(path.join(source, 'hello.txt'), 'hello\n');
  git('add', '.'); git('commit', '-m', 'initial'); await fs.writeFile(path.join(source, 'private.txt'), 'device secret');
  const registered = [], receiptDirectory = path.join(root, 'receipts'); let now = 100;
  const registrar = { ready: async () => true, register: async ({ path, name }) => { registered.push({ path, name }); return { projectId: 'native-id' }; } };
  const a = new LocalProjectReplicaAdapter({ projectProvider: async () => [{ path: source, name: 'source' }], taskProvider: async () => [] });
  const b = new LocalProjectReplicaAdapter({ projectProvider: async () => registered, taskProvider: async () => [], creationRoots: [parent], registrar, receiptDirectory, now: () => now });
  t.after(() => b.disposeCreations());
  b.peer = { id: 'target', name: 'Target' };
  const service = new ProjectReplicaService({ localAdapter: a, localDevice: { id: 'source', name: 'Source' }, peers: [b], now: () => now });
  const input = { source: { deviceId: 'source', path: source }, deviceId: 'target', parent, name: '新副本' };
  return { root, source, parent, a, b, service, input, registrar, git, registered, receiptDirectory, setNow: n => { now = n; } };
}

test('new replica copies committed history, registers natively and is independently readable without source config or ignored data', async t => {
  const f = await fixture(t); const preview = await f.service.createPreflight(f.input);
  await assert.rejects(fs.stat(preview.target.path), { code: 'ENOENT' });
  const result = await f.service.createExecute({ token: preview.token });
  assert.equal(result.verified, true); assert.equal(result.target.head, f.git('rev-parse', 'HEAD'));
  assert.equal((await fs.readFile(path.join(result.target.path, 'hello.txt'), 'utf8')).replaceAll('\r\n', '\n'), 'hello\n');
  await assert.rejects(fs.stat(path.join(result.target.path, 'private.txt')), { code: 'ENOENT' });
  const config = await fs.readFile(path.join(result.target.path, '.git/config'), 'utf8');
  assert.doesNotMatch(config, /fixture@example|\[remote /);
  assert.equal(f.registered.length, 1);
  const receipt = JSON.parse(await fs.readFile(path.join(f.receiptDirectory, `${result.operationId}.json`), 'utf8'));
  assert.equal(receipt.phase, 'completed');
  await assert.rejects(f.service.createExecute({ token: preview.token }), /过期或使用/);
});

test('existing directories, escaped names and nested repositories cannot be overwritten', async t => {
  const f = await fixture(t);
  for (const name of ['../escape', 'CON', 'a/b', '.git', 'tail.', 'tail ']) await assert.rejects(f.service.createPreflight({ ...f.input, name }));
  await fs.mkdir(path.join(f.parent, f.input.name));
  await fs.writeFile(path.join(f.parent, f.input.name, 'keep'), 'keep');
  await assert.rejects(f.service.createPreflight(f.input), /已存在/);
  assert.equal(await fs.readFile(path.join(f.parent, f.input.name, 'keep'), 'utf8'), 'keep');
  f.b.creationRoots.push(f.source);
  await assert.rejects(f.service.createPreflight({ ...f.input, parent: f.source }), /Git 仓库/);
});

test('target appearing after preflight and source changing both consume preview without writes', async t => {
  const f = await fixture(t), p = await f.service.createPreflight(f.input);
  await fs.mkdir(p.target.path);
  await assert.rejects(f.service.createExecute({ token: p.token }), /已存在/);
  assert.deepEqual(await fs.readdir(p.target.path), []);
  const q = await f.service.createPreflight({ ...f.input, name: 'next' });
  await fs.writeFile(path.join(f.source, 'hello.txt'), 'changed'); f.git('add', '.'); f.git('commit', '-m', 'change');
  await assert.rejects(f.service.createExecute({ token: q.token }), /源版本已变化/);
  await assert.rejects(fs.stat(q.target.path), { code: 'ENOENT' });
});

test('registration cancellation preserves checkout and receipt, never reports success or deletes files', async t => {
  const f = await fixture(t), p = await f.service.createPreflight(f.input);
  f.registrar.register = async () => { throw Error('native confirmation cancelled'); };
  const pending = await f.service.createExecute({ token: p.token });
  assert.equal(pending.verified, false);
  assert.match(pending.message, /副本目录已保留/);
  assert.equal((await fs.readFile(path.join(p.target.path, 'hello.txt'), 'utf8')).replaceAll('\r\n', '\n'), 'hello\n');
  const receipts = await fs.readdir(f.receiptDirectory);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.receiptDirectory, receipts[0]), 'utf8')).phase, 'needs-review');
  await assert.rejects(f.service.createPreflight(f.input), /已存在/);
  f.registrar.register = async ({ path, name }) => { f.registered.push({ path, name }); return { projectId: 'native-id' }; };
  const recovered = await f.service.createResume({ deviceId: 'target', operationId: pending.operationId });
  assert.equal(recovered.verified, true);
  assert.equal(recovered.target.head, f.git('rev-parse', 'HEAD'));
  assert.equal((await f.service.createResume({ deviceId: 'target', operationId: pending.operationId })).verified, true);
  assert.equal(f.registered.length, 1);
});

test('unavailable native capability and expired permits fail before directory creation', async t => {
  const f = await fixture(t), p = await f.service.createPreflight(f.input);
  f.registrar.ready = async () => { throw Error('unsupported'); };
  await assert.rejects(f.service.createExecute({ token: p.token }), /unsupported/);
  await assert.rejects(fs.stat(p.target.path), { code: 'ENOENT' });
  f.registrar.ready = async () => true;
  const q = await f.service.createPreflight(f.input); f.setNow(1000000);
  await assert.rejects(f.service.createExecute({ token: q.token }), /过期/);
});

test('symbolic-link parents are refused even when explicitly configured', async t => {
  const f = await fixture(t), alias = path.join(f.root, 'alias');
  await fs.symlink(f.parent, alias, process.platform === 'win32' ? 'junction' : 'dir');
  f.b.creationRoots.push(alias);
  await assert.rejects(f.service.createPreflight({ ...f.input, parent: alias }), /符号链接/);
});
