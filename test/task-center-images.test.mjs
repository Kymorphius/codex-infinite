import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createTaskCenterImages } from '../src/task-center-images.mjs';
import { checkedBundle, checkedImage, imageCacheKey, imageDigest, MAX_IMAGE_BYTES, projectedImageId } from '../src/task-center-image-bundle.mjs';
import { ProjectChecklistStore } from '../src/project-checklist-store.mjs';
import { GENERAL_TASK_SCOPE_ID, taskRevision } from '../src/task-center-contract.mjs';

const OWNER = { id: 'source-mac' }, TARGET = { id: 'target-windows' }, ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ref = index => `${ID}:${index}`;
const input = ids => [{ type: 'text', text: '图片任务' }, ...ids.map(id => ({ type: 'heldImage', id }))];
const bytes = tail => Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, tail]);
const image = (id, tail = 0) => ({ id, mimeType: 'image/png', sha256: imageDigest(bytes(tail)), dataUrl: `data:image/png;base64,${bytes(tail).toString('base64')}` });

function nativeConnection(initial = [], href = 'app://-/index.html') {
  const blobs = new Map(initial.map(value => [value.id, new Blob([Buffer.from(value.dataUrl.split(',')[1], 'base64')], { type: value.mimeType })]));
  const db = {
    objectStoreNames: { contains: () => true },
    transaction: () => {
      const tx = {};
      tx.objectStore = () => Object.fromEntries(['get', 'put', 'delete'].map(method => [method, (...args) => {
        const request = {};
        queueMicrotask(() => {
          request.result = method === 'get' ? blobs.get(args[0]) : method === 'put' ? blobs.set(args[1], args[0]) && args[1] : blobs.delete(args[0]);
          request.onsuccess?.(); tx.oncomplete?.();
        });
        return request;
      }]));
      return tx;
    }
  };
  const context = vm.createContext({ window: {}, location: { href }, Blob, atob, Uint8Array,
    indexedDB: { open: () => { const request = {}; queueMicrotask(() => { request.result = db; request.onsuccess?.(); }); return request; } },
    FileReader: class { readAsDataURL(blob) { blob.arrayBuffer().then(value => { this.result = `data:${blob.type};base64,${Buffer.from(value).toString('base64')}`; this.onload(); }); } }
  });
  return { blobs, async evaluate(expression) { const value = await vm.runInContext(expression, context); return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); } };
}
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'task-images-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new ProjectChecklistStore(path.join(directory, 'checklists'));
  const save = async (id, refs) => {
    await store.apply({ projectKey: 'ccc:general-inbox:v1', id, requestId: `save-${id}`, type: 'upsert', text: '图片任务', done: false, input: input(refs) });
    return { ...(await store.readScope(GENERAL_TASK_SCOPE_ID)).items.find(value => value.id === id) };
  };
  const source = createTaskCenterImages({ directory: path.join(directory, 'source'), localDevice: OWNER, store });
  return { directory, store, source, save };
}

test('source captures native IndexedDB and exports only the exact task revision attachments', async t => {
  const { source, save } = await fixture(t), item = await save('task-one', [ref(0), ref(1)]);
  const connection = nativeConnection([image(ref(0)), image(ref(1), 1), image(ref(2), 2)]);
  assert.deepEqual(await source.sync(connection), { errors: [] });
  connection.blobs.clear();
  const request = { scopeId: GENERAL_TASK_SCOPE_ID, id: item.id, expectedRevision: taskRevision(item) };
  const bundle = await source.exportBundle(request);
  assert.deepEqual(bundle.images, [image(ref(0)), image(ref(1), 1)]);
  await assert.rejects(source.exportBundle({ ...request, expectedRevision: '0'.repeat(64) }), /任务已变化/);
  await assert.rejects(source.exportBundle({ ...request, id: ref(2) }), /不存在/);
  await assert.rejects(source.exportBundle({ ...request, scopeId: '../../private' }), /无效任务清单/);
});

test('target restores bytes, handles unordered bundles, isolates same reference across owners and caches downloads', async t => {
  const { directory, store } = await fixture(t), connection = nativeConnection();
  let downloads = 0;
  const target = createTaskCenterImages({ directory: path.join(directory, 'target'), localDevice: TARGET, store,
    fetchRemoteBundle: async item => { downloads++; return { version: 1, images: [image(ref(1), 2), image(ref(0), item.ownerDeviceId === OWNER.id ? 0 : 1)] }; }
  });
  const item = { ownerDeviceId: OWNER.id, scopeId: GENERAL_TASK_SCOPE_ID, id: 'one', revision: 'a'.repeat(64), input: input([ref(0), ref(1)]) };
  const mapped = await target.prepareRemoteInput(connection, item);
  assert.equal(mapped[1].id, projectedImageId(OWNER.id, ref(0)));
  assert.deepEqual(target.originalInput(item, mapped), item.input);
  assert.deepEqual(await connection.blobs.get(mapped[1].id).arrayBuffer().then(value => Buffer.from(value)), bytes(0));
  await target.prepareRemoteInput(connection, item);
  assert.equal(downloads, 1);
  const other = await target.prepareRemoteInput(connection, { ...item, ownerDeviceId: 'other-mac' });
  assert.notEqual(other[1].id, mapped[1].id);
  assert.deepEqual(await connection.blobs.get(other[1].id).arrayBuffer().then(value => Buffer.from(value)), bytes(1));
  assert.equal(downloads, 2);
  const restarted = createTaskCenterImages({ directory: path.join(directory, 'target'), localDevice: TARGET, store, fetchRemoteBundle: async () => assert.fail('cached bytes should work offline') });
  const newRenderer = nativeConnection();
  await restarted.prepareRemoteInput(newRenderer, item);
  assert.equal(newRenderer.blobs.size, 2);
  assert.throws(() => target.originalInput(item, input([ref(5)])), /引用已变化/);
});

test('bundle rejects missing, extra, duplicate, corrupted, MIME spoofed and oversized attachments before import', async t => {
  const { directory, store } = await fixture(t);
  const cases = [[], [image(ref(1))], [image(ref(0)), image(ref(0))], [{ ...image(ref(0)), sha256: '0'.repeat(64) }], [{ ...image(ref(0)), mimeType: 'image/jpeg' }]];
  for (let index = 0; index < cases.length; index++) {
    const connection = nativeConnection(), target = createTaskCenterImages({ directory: path.join(directory, `invalid-${index}`), localDevice: TARGET, store, fetchRemoteBundle: async () => ({ version: 1, images: cases[index] }) });
    await assert.rejects(target.prepareRemoteInput(connection, { ownerDeviceId: OWNER.id, scopeId: GENERAL_TASK_SCOPE_ID, id: 'task', revision: 'a', input: input([ref(0)]) }));
    assert.equal(connection.blobs.size, 0);
  }
  const large = Buffer.alloc(MAX_IMAGE_BYTES + 1); bytes(0).copy(large);
  assert.throws(() => checkedImage({ ...image(ref(0)), dataUrl: `data:image/png;base64,${large.toString('base64')}` }), /大小/);
  const full = large.subarray(0, MAX_IMAGE_BYTES), fullImage = { id: ref(0), mimeType: 'image/png', sha256: imageDigest(full), dataUrl: `data:image/png;base64,${full.toString('base64')}` };
  assert.throws(() => checkedBundle({ version: 1, images: [0, 1, 2, 3].map(index => ({ ...fullImage, id: ref(index) })) }, [0, 1, 2, 3].map(ref)), /24 MiB/);
});

test('historical missing image does not block other tasks; assigning a missing image fails explicitly', async t => {
  const { source, save } = await fixture(t), lost = await save('lost', [ref(0)]), valid = await save('valid', [ref(1)]);
  const synced = await source.sync(nativeConnection([image(ref(1), 1)]));
  assert.equal(synced.errors.length, 1);
  assert.equal(synced.errors[0].id, 'lost');
  await source.prepareAssignment({ item: valid });
  await assert.rejects(source.prepareAssignment({ item: lost }), /丢失或损坏/);
  await source.prepareAssignment({ item: { input: input([]) } });
});

test('offline source and wrong native origin fail without creating renderer images', async t => {
  const { directory, store, source, save } = await fixture(t), item = await save('one', [ref(0)]);
  await assert.rejects(source.prepareAssignment({ item }), /原生窗口尚未连接/);
  await assert.rejects(source.capture(nativeConnection([image(ref(0))], 'https://example.com/'), item.input), /原生窗口读取/);
  const target = createTaskCenterImages({ directory: path.join(directory, 'target'), localDevice: TARGET, store, fetchRemoteBundle: async () => { throw Error('来源离线'); } });
  const connection = nativeConnection();
  await assert.rejects(target.prepareRemoteInput(connection, { ...item, ownerDeviceId: OWNER.id, scopeId: GENERAL_TASK_SCOPE_ID }), /来源离线/);
  assert.equal(connection.blobs.size, 0);
});

test('persistent cache refuses symlinks rather than reading arbitrary files', async t => {
  const { directory, source, save } = await fixture(t), item = await save('one', [ref(0)]);
  const cacheDir = path.join(directory, 'source');
  await fs.mkdir(cacheDir);
  await fs.writeFile(path.join(directory, 'unrelated'), JSON.stringify({ ownerDeviceId: OWNER.id, ...image(ref(0)) }));
  await fs.symlink(path.join(directory, 'unrelated'), path.join(cacheDir, imageCacheKey(OWNER.id, ref(0)) + '.json'));
  await assert.rejects(source.prepareAssignment({ item }), /缓存无效/);
});

test('source refuses an export if the task changes while reading image bytes', async t => {
  const { store, source, save } = await fixture(t), item = await save('one', [ref(0)]);
  await source.sync(nativeConnection([image(ref(0))]));
  const readScope = store.readScope.bind(store); let reads = 0;
  store.readScope = async scopeId => {
    const value = await readScope(scopeId);
    if (++reads === 2) value.items[0].text = 'edited while exporting';
    return value;
  };
  await assert.rejects(source.exportBundle({ scopeId: GENERAL_TASK_SCOPE_ID, id: item.id, expectedRevision: taskRevision(item) }), /任务已变化/);
});
