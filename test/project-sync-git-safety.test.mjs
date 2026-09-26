import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { LocalProjectSyncAdapter } from '../src/local-project-sync-adapter.mjs';
import { decodePackage } from '../src/project-sync-git-package.mjs';
import { PROJECT_SYNC_MAX_BUNDLE_BYTES, sameFilesystemPath } from '../src/project-sync-git.mjs';

const run = (root, ...args) => execFileSync('git', ['-c', 'user.name=Sync Test', '-c', 'user.email=sync@example.invalid', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

async function fixture(t, format = 'sha1') {
  const parent = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'project-sync-safety-')));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const source = path.join(parent, 'source');
  const target = path.join(parent, 'target');
  await fs.mkdir(source);
  run(source, 'init', '--initial-branch=main', `--object-format=${format}`);
  await fs.writeFile(path.join(source, 'app.txt'), 'one\n');
  run(source, 'add', 'app.txt');
  run(source, 'commit', '-m', 'initial');
  run(parent, 'clone', source, target);
  let projects = [source, target].map(root => ({ path: root, name: path.basename(root) }));
  const adapter = new LocalProjectSyncAdapter({ projectProvider: async () => projects, taskProvider: async () => [] });
  const commit = async (file, content) => {
    await fs.mkdir(path.dirname(path.join(source, file)), { recursive: true });
    await fs.writeFile(path.join(source, file), content);
    run(source, 'add', '--', file);
    run(source, 'commit', '-m', 'new file');
  };
  const rawPackage = () => {
    const bytes = execFileSync('git', ['bundle', 'create', '-', 'HEAD'], { cwd: source, stdio: ['ignore', 'pipe', 'pipe'] });
    return { head: run(source, 'rev-parse', 'HEAD'), branch: 'main', bundle: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex') };
  };
  return { parent, source, target, adapter, commit, rawPackage, addProject: root => { projects.push({ path: root, name: 'extra' }); } };
}

test('unknown roots, subdirectories and symlink roots or ancestors cannot bypass registration', async t => {
  const f = await fixture(t);
  await assert.rejects(f.adapter.inspect({ path: f.parent }), { code: 'PROJECT_NOT_REGISTERED' });
  await assert.rejects(f.adapter.inspect({ path: `${f.source}/../source` }), { code: 'INVALID_PROJECT_PATH' });
  const nested = path.join(f.source, 'nested');
  await fs.mkdir(nested);
  f.addProject(nested);
  await assert.rejects(f.adapter.inspect({ path: nested }), { code: 'UNSUPPORTED_REPOSITORY' });
  const alias = path.join(f.parent, 'alias');
  await fs.symlink(f.source, alias, 'dir');
  f.addProject(alias);
  await assert.rejects(f.adapter.inspect({ path: alias }), { code: 'UNSUPPORTED_PROJECT_PATH' });
  const parentAlias = path.join(f.parent, 'alias-parent');
  await fs.symlink(f.parent, parentAlias, 'dir');
  f.addProject(path.join(parentAlias, 'source'));
  await assert.rejects(f.adapter.inspect({ path: path.join(parentAlias, 'source') }), { code: 'UNSUPPORTED_PROJECT_PATH' });
});

test('worktrees, detached HEAD and in-progress Git state are rejected', async t => {
  const f = await fixture(t);
  const worktree = path.join(f.parent, 'worktree');
  run(f.source, 'worktree', 'add', '-b', 'other', worktree);
  f.addProject(worktree);
  await assert.rejects(f.adapter.inspect({ path: worktree }), { code: 'UNSUPPORTED_REPOSITORY' });
  await assert.rejects(f.adapter.inspect({ path: f.source }), { code: 'UNSUPPORTED_GIT_STATE' });
  run(f.source, 'worktree', 'remove', worktree);
  run(f.source, 'checkout', '--detach');
  await assert.rejects(f.adapter.inspect({ path: f.source }), { code: 'DETACHED_HEAD' });
  run(f.source, 'switch', 'main');
  await fs.writeFile(path.join(f.source, '.git', 'MERGE_HEAD'), run(f.source, 'rev-parse', 'HEAD'));
  await assert.rejects(f.adapter.inspect({ path: f.source }), { code: 'UNSUPPORTED_GIT_STATE' });
});

test('common credentials in current content and deleted history are blocked', async t => {
  const f = await fixture(t);
  await f.commit('.env.local', 'SECRET=do-not-transfer\n');
  await assert.rejects(f.adapter.inspect({ path: f.source }), { code: 'CREDENTIAL_FILE' });
  run(f.source, 'rm', '.env.local');
  run(f.source, 'commit', '-m', 'remove secret');
  await assert.rejects(f.adapter.inspect({ path: f.source }), { code: 'CREDENTIAL_FILE' });
  await assert.rejects(f.adapter.prepare({ path: f.target, expected: await f.adapter.inspect({ path: f.target }), package: f.rawPackage() }), { code: 'CREDENTIAL_FILE' });
});

test('submodules, LFS pointers and filters are rejected in incoming packages', async t => {
  for (const [file, content, code] of [
    ['.gitmodules', '[submodule "one"]\npath=one\nurl=https://example.invalid/repo\n', 'UNSUPPORTED_SUBMODULE'],
    ['large.bin', `version https://git-lfs.github.com/spec/v1\noid sha256:${'a'.repeat(64)}\nsize 1\n`, 'UNSUPPORTED_LFS'],
    ['.gitattributes', '*.dat filter=lfs diff=lfs merge=lfs -text\n', 'UNSUPPORTED_FILTER'],
    ['.gitattributes', '*.txt filter=machine-command\n', 'UNSUPPORTED_FILTER']
  ]) {
    const f = await fixture(t);
    await f.commit(file, content);
    await assert.rejects(f.adapter.inspect({ path: f.source }), { code });
    await assert.rejects(f.adapter.prepare({ path: f.target, expected: await f.adapter.inspect({ path: f.target }), package: f.rawPackage() }), { code });
    assert.equal(run(f.target, 'rev-parse', 'HEAD'), run(f.target, 'rev-parse', 'origin/main'));
  }
});

test('bundles enforce checksum, base64, decoded size, advertised head and exact refs', async t => {
  const f = await fixture(t);
  const pkg = f.rawPackage();
  const expected = await f.adapter.inspect({ path: f.target });
  const prepare = packageValue => f.adapter.prepare({ path: f.target, expected, package: packageValue });
  for (const invalid of [{ ...pkg, sha256: '0'.repeat(64) }, { ...pkg, bundle: `${pkg.bundle}\n` }, { ...pkg, head: 'a'.repeat(40) }, { ...pkg, branch: 'refs/../bad' }]) {
    await assert.rejects(prepare(invalid), { code: 'INVALID_SYNC_PACKAGE' });
  }
  const oversized = Buffer.alloc(PROJECT_SYNC_MAX_BUNDLE_BYTES + 1);
  assert.throws(() => decodePackage({ ...pkg, bundle: oversized.toString('base64'), sha256: createHash('sha256').update(oversized).digest('hex') }), { code: 'INVALID_SYNC_PACKAGE' });
  run(f.source, 'tag', 'extra');
  const bytes = execFileSync('git', ['bundle', 'create', '-', '--all'], { cwd: f.source, stdio: ['ignore', 'pipe', 'pipe'] });
  await assert.rejects(prepare({ ...pkg, bundle: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex') }), { code: 'INVALID_SYNC_PACKAGE' });
});

test('Windows Git slash and case conventions compare without allowing different roots', () => {
  assert.equal(sameFilesystemPath('C:/Users/User/project', 'c:\\users\\user\\project', 'win32'), true);
  assert.equal(sameFilesystemPath('C:/Users/User/project/.git', 'C:\\Users\\User\\project\\.git', 'win32'), true);
  assert.equal(sameFilesystemPath('C:/project', 'C:\\other-project', 'win32'), false);
  assert.equal(sameFilesystemPath('D:/project', 'C:\\project', 'win32'), false);
  assert.equal(sameFilesystemPath('/var/project', '/private/var/project', 'darwin'), false);
});

test('ignored symlink directories and case variants cannot be overwritten or traversed', async t => {
  const f = await fixture(t);
  await f.commit('.gitignore', 'cache\nCACHE\n');
  run(f.target, 'fetch', f.source, 'main');
  run(f.target, 'merge', '--ff-only', 'FETCH_HEAD');
  const outside = path.join(f.parent, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'private.txt'), 'keep private data\n');
  const ignoredName = process.platform === 'linux' ? 'cache' : 'CACHE';
  await fs.symlink(outside, path.join(f.target, ignoredName), 'dir');
  await fs.mkdir(path.join(f.source, 'cache'));
  await fs.writeFile(path.join(f.source, 'cache', 'incoming.txt'), 'incoming\n');
  run(f.source, 'add', '--force', 'cache/incoming.txt');
  run(f.source, 'commit', '-m', 'new tracked path');
  await assert.rejects(f.adapter.prepare({ path: f.target, expected: await f.adapter.inspect({ path: f.target }), package: f.rawPackage() }), { code: 'IGNORED_FILE_COLLISION' });
  assert.equal(await fs.readFile(path.join(outside, 'private.txt'), 'utf8'), 'keep private data\n');
  assert.deepEqual(await fs.readdir(outside), ['private.txt']);
  assert.equal((await fs.lstat(path.join(f.target, ignoredName))).isSymbolicLink(), true);
});

test('gitlink entries and alternate object storage are rejected', async t => {
  const f = await fixture(t);
  run(f.source, 'update-index', '--add', '--cacheinfo', `160000,${run(f.source, 'rev-parse', 'HEAD')},module`);
  run(f.source, 'commit', '-m', 'gitlink');
  await assert.rejects(f.adapter.prepare({ path: f.target, expected: await f.adapter.inspect({ path: f.target }), package: f.rawPackage() }), { code: 'UNSUPPORTED_SUBMODULE' });
  await fs.writeFile(path.join(f.target, '.git', 'objects', 'info', 'alternates'), path.join(f.source, '.git', 'objects'));
  await assert.rejects(f.adapter.inspect({ path: f.target }), { code: 'UNSUPPORTED_GIT_STATE' });
});

test('partial clones and packed replacement refs are blocked without fetching', async t => {
  const f = await fixture(t);
  run(f.source, 'config', 'remote.origin.promisor', 'true');
  await assert.rejects(f.adapter.inspect({ path: f.source }), { code: 'UNSUPPORTED_GIT_STATE' });
  run(f.source, 'config', '--unset', 'remote.origin.promisor');
  const previous = run(f.source, 'rev-parse', 'HEAD');
  await f.commit('app.txt', 'new\n');
  run(f.source, 'replace', previous, run(f.source, 'rev-parse', 'HEAD'));
  run(f.source, 'pack-refs', '--all', '--prune');
  await assert.rejects(f.adapter.inspect({ path: f.source }), { code: 'UNSUPPORTED_GIT_STATE' });
});

test('tracked and working attributes are rejected before status can execute clean filters', async t => {
  for (const tracked of [true, false]) {
    const f = await fixture(t);
    const marker = path.join(f.parent, 'filter-ran');
    const command = `node -e 'require("node:fs").writeFileSync(${JSON.stringify(marker)},"executed");process.stdin.pipe(process.stdout)'`;
    if (tracked) await f.commit('.gitattributes', '*.txt filter=marker\n');
    else await fs.writeFile(path.join(f.source, '.gitattributes'), '*.txt filter=marker\n');
    run(f.source, 'config', 'filter.marker.clean', command);
    await fs.writeFile(path.join(f.source, 'app.txt'), 'dirty data\n');
    await assert.rejects(f.adapter.inspect({ path: f.source }), { code: 'UNSUPPORTED_FILTER' });
    assert.equal(await fs.stat(marker).then(() => true, () => false), false);
  }
});

test('local info attributes are rejected before clean or smudge filters can execute', async t => {
  const f = await fixture(t);
  const marker = path.join(f.parent, 'info-filter-ran');
  const command = `node -e 'require("node:fs").writeFileSync(${JSON.stringify(marker)},"executed");process.stdin.pipe(process.stdout)'`;
  run(f.target, 'config', 'filter.marker.clean', command);
  run(f.target, 'config', 'filter.marker.smudge', command);
  await f.commit('app.txt', 'updated\n');
  const plan = await f.adapter.prepare({ path: f.target, expected: await f.adapter.inspect({ path: f.target }), package: f.rawPackage() });
  await fs.writeFile(path.join(f.target, '.git', 'info', 'attributes'), '*.txt filter=marker\n');
  await assert.rejects(f.adapter.inspect({ path: f.target }), { code: 'UNSUPPORTED_FILTER' });
  await assert.rejects(f.adapter.apply({ token: plan.token }), { code: 'UNSUPPORTED_FILTER' });
  assert.equal(await fs.stat(marker).then(() => true, () => false), false);
});

test('attributes staged then removed from disk cannot execute an index fallback filter', async t => {
  const f = await fixture(t);
  const marker = path.join(f.parent, 'index-filter-ran');
  const command = `node -e 'require("node:fs").writeFileSync(${JSON.stringify(marker)},"executed");process.stdin.pipe(process.stdout)'`;
  await fs.writeFile(path.join(f.source, '.gitattributes'), '*.txt filter=marker\n');
  run(f.source, 'add', '.gitattributes');
  await fs.rm(path.join(f.source, '.gitattributes'));
  run(f.source, 'config', 'filter.marker.clean', command);
  await fs.writeFile(path.join(f.source, 'app.txt'), 'dirty\n');
  await assert.rejects(f.adapter.inspect({ path: f.source }), { code: 'UNSUPPORTED_FILTER' });
  assert.equal(await fs.stat(marker).then(() => true, () => false), false);
});

test('external attributes cannot execute configured clean or smudge filters', async t => {
  const f = await fixture(t);
  const marker = path.join(f.parent, 'external-filter-ran');
  const attributes = path.join(f.parent, 'global-attributes');
  const command = `node -e 'require("node:fs").writeFileSync(${JSON.stringify(marker)},"executed");process.stdin.pipe(process.stdout)'`;
  await fs.writeFile(attributes, '*.txt filter=marker\n');
  run(f.target, 'config', 'core.attributesFile', attributes);
  run(f.target, 'config', 'filter.marker.clean', command);
  run(f.target, 'config', 'filter.marker.smudge', command);
  await f.commit('app.txt', 'updated\n');
  const plan = await f.adapter.prepare({ path: f.target, expected: await f.adapter.inspect({ path: f.target }), package: f.rawPackage() });
  const result = await f.adapter.apply({ token: plan.token });
  assert.equal(result.target.head, run(f.source, 'rev-parse', 'HEAD'));
  assert.equal(result.target.clean, true);
  assert.equal(await fs.stat(marker).then(() => true, () => false), false);
});

test('ignored attributes in newly populated directories cannot execute smudge filters', async t => {
  const f = await fixture(t);
  await f.commit('.gitignore', 'newdir/.gitattributes\n');
  run(f.target, 'fetch', f.source, 'main');
  run(f.target, 'merge', '--ff-only', 'FETCH_HEAD');
  const expected = await f.adapter.inspect({ path: f.target });
  await f.commit('newdir/file.txt', 'incoming\n');
  const marker = path.join(f.parent, 'ignored-filter-ran');
  const command = `node -e 'require("node:fs").writeFileSync(${JSON.stringify(marker)},"executed");process.stdin.pipe(process.stdout)'`;
  run(f.target, 'config', 'filter.marker.smudge', command);
  await fs.mkdir(path.join(f.target, 'newdir'));
  await fs.writeFile(path.join(f.target, 'newdir', '.gitattributes'), '*.txt filter=marker\n');
  await assert.rejects(f.adapter.prepare({ path: f.target, expected, package: f.rawPackage() }), { code: 'UNSUPPORTED_FILTER' });
  assert.equal(await fs.stat(marker).then(() => true, () => false), false);
  assert.equal(await fs.stat(path.join(f.target, 'newdir', 'file.txt')).then(() => true, () => false), false);
});

test('SHA-256 repositories use the matching package object format', async t => {
  const f = await fixture(t, 'sha256');
  await f.commit('app.txt', 'two\n');
  const pkg = await f.adapter.export({ path: f.source, expected: await f.adapter.inspect({ path: f.source }) });
  assert.equal(pkg.head.length, 64);
  const prepared = await f.adapter.prepare({ path: f.target, expected: await f.adapter.inspect({ path: f.target }), package: pkg });
  const result = await f.adapter.apply({ token: prepared.token });
  assert.equal(result.target.head, pkg.head);
});
