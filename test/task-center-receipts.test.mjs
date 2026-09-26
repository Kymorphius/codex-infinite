import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProjectChecklistStore } from '../src/project-checklist-store.mjs';
import { TaskCenterOwner } from '../src/task-center-owner.mjs';

const GENERAL = 'ccc:general-inbox:v1';
const create = { ownerDeviceId: 'mac', id: 'a', requestId: 'original-request', type: 'create', text: '最初内容' };
function edit(item, index) {
  return { ownerDeviceId: 'mac', scopeId: item.scopeId, id: item.id, requestId: 'edit-' + index, type: 'edit', expectedRevision: item.revision, text: String(index) + '内容'.repeat(2400) };
}
async function setup(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'task-receipt-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new ProjectChecklistStore(directory);
  return { directory, store, owner: new TaskCenterOwner({ checklistStore: store, localDevice: { id: 'mac' } }) };
}

test('large repeated edits keep the checklist bounded while all old receipts survive deletion and restart', async t => {
  const { owner, store, directory } = await setup(t);
  const original = await owner.apply(create);
  let item = original.item;
  const history = [];
  for (let index = 0; index < 60; index++) {
    const action = edit(item, index), result = await owner.apply(action);
    history.push({ action, result }); item = result.item;
    assert.ok((await fs.stat(store.file(GENERAL))).size < 40_000);
    assert.equal((await store.read(GENERAL)).taskReceipts.length, 1);
  }
  await owner.apply({ ownerDeviceId: 'mac', scopeId: item.scopeId, id: item.id, requestId: 'delete', type: 'delete', expectedRevision: item.revision });
  assert.ok((await fs.stat(store.file(GENERAL))).size < 1000);
  assert.equal((await fs.readdir(path.join(directory, 'task-receipts'))).length, 61);
  const restarted = new TaskCenterOwner({ checklistStore: new ProjectChecklistStore(directory), localDevice: { id: 'mac' } });
  assert.deepEqual(await restarted.apply(create), original);
  for (const entry of [history[0], history[20], history[59]]) assert.deepEqual(await restarted.apply(entry.action), entry.result);
  await assert.rejects(restarted.apply({ ...create, text: '同号不同内容' }), { code: 'REQUEST_ID_CONFLICT' });
  assert.equal((await restarted.read()).items.length, 0);
});

test('archive failure leaves old task and inline receipt intact; crash after archive also remains replay safe', async t => {
  const { owner, store, directory } = await setup(t);
  const original = await owner.apply(create), action = edit(original.item, 1);
  const before = await fs.readFile(store.file(GENERAL), 'utf8');
  const archive = store.receiptArchive.store.bind(store.receiptArchive);
  store.receiptArchive.store = async () => { throw Error('archive unavailable'); };
  await assert.rejects(owner.apply(action), /archive unavailable/);
  assert.equal(await fs.readFile(store.file(GENERAL), 'utf8'), before);
  store.receiptArchive.store = archive;
  store.writeScope = async () => { throw Error('crash before state commit'); };
  await assert.rejects(owner.apply(action), /crash before state commit/);
  assert.equal(await fs.readFile(store.file(GENERAL), 'utf8'), before);
  assert.ok(await store.receiptArchive.read(create.requestId));
  const restoredStore = new ProjectChecklistStore(directory);
  const restarted = new TaskCenterOwner({ checklistStore: restoredStore, localDevice: { id: 'mac' } });
  assert.deepEqual(await restarted.apply(create), original);
  const changed = await restarted.apply(action);
  assert.equal(changed.item.text, action.text);
  assert.equal((await restoredStore.read(GENERAL)).taskReceipts.length, 1);
  assert.deepEqual(await restarted.apply(action), changed);
});

test('receipt archive directories and files cannot redirect reads or writes through symlinks', async t => {
  const { owner, store, directory } = await setup(t);
  const original = await owner.apply(create), before = await fs.readFile(store.file(GENERAL), 'utf8');
  const outside = path.join(directory, 'outside'); await fs.mkdir(outside);
  await fs.symlink(outside, store.receiptArchive.directory);
  await assert.rejects(owner.apply(edit(original.item, 1)), /符号链接/);
  assert.equal(await fs.readFile(store.file(GENERAL), 'utf8'), before);
  assert.equal((await fs.readdir(outside)).length, 0);
  await fs.unlink(store.receiptArchive.directory); await fs.mkdir(store.receiptArchive.directory);
  const foreign = path.join(outside, 'receipt.json'); await fs.writeFile(foreign, '{}');
  await fs.symlink(foreign, store.receiptArchive.file('edit-1'));
  await assert.rejects(owner.apply(edit(original.item, 1)), /符号链接/);
  assert.equal(await fs.readFile(foreign, 'utf8'), '{}');
});
