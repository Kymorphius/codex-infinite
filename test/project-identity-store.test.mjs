import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProjectIdentityStore } from '../src/project-identity-store.mjs';

async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-identity-store-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const filePath = path.join(root, 'identities.json');
  return { root, filePath, store: new ProjectIdentityStore({ filePath }) };
}

test('mappings survive restart, preserve other roots, and compare before unlinking', async t => {
  const { store, root, filePath } = await setup(t), other = path.join(root, 'other'), id = randomUUID(), next = randomUUID();
  await store.set(root, null, id); await store.set(other, null, next);
  const restarted = new ProjectIdentityStore({ filePath });
  assert.equal((await restarted.read()).get(root), id);
  await assert.rejects(restarted.set(root, null, next), /关联已变化/);
  await assert.rejects(restarted.set(root, next, null), /关联已变化/);
  await restarted.set(root, id, null);
  assert.deepEqual([...await restarted.read()], [[other, next]]);
  await restarted.set(root, id, null); // A reply lost after successful unlink is idempotent.
});

test('concurrent store instances never lose another write or overwrite competing identities', async t => {
  const { root, filePath, store } = await setup(t), other = new ProjectIdentityStore({ filePath });
  const ids = [randomUUID(), randomUUID()];
  const results = await Promise.allSettled([store.set(root, null, ids[0]), other.set(root, null, ids[1])]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.ok(ids.includes((await store.read()).get(root)));
  assert.equal((await fs.readdir(path.dirname(filePath))).some(file => /\.lock$|\.tmp$/.test(file)), false);
});

test('malformed, duplicate, oversized, unsupported stores and abandoned locks fail closed', async t => {
  const { root, filePath, store } = await setup(t), id = randomUUID();
  for (const body of ['broken', JSON.stringify({ version: 2, entries: [] }), ' '.repeat(4 * 1024 * 1024 + 1),
    JSON.stringify({ version: 1, entries: [{ path: root, projectId: id }, { path: root, projectId: id }] }),
    JSON.stringify({ version: 1, entries: [{ path: root, projectId: 'bad' }] })]) {
    await fs.writeFile(filePath, body);
    await assert.rejects(store.set(root, null, id), /无法读取/);
    assert.equal(await fs.readFile(filePath, 'utf8'), body);
  }
  await fs.rm(filePath);
  await fs.writeFile(`${filePath}.lock`, 'owned by interrupted operation');
  await assert.rejects(store.set(root, null, id), /遗留写锁/);
  assert.equal(await fs.readFile(`${filePath}.lock`, 'utf8'), 'owned by interrupted operation');
});
