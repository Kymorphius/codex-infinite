import { createNativeHeldImageTools } from './native-held-image-tools.mjs';
import { normalizeChecklistInput } from './project-checklist-input.mjs';
import { taskRevision, validateTaskScopeId, taskCenterError } from './task-center-contract.mjs';
import { checkedBundle, imageRefs, imageFailure, projectedImageId } from './task-center-image-bundle.mjs';
import { createTaskImageStorage } from './task-center-image-storage.mjs';

const rendererSource = `(${createNativeHeldImageTools.toString()})`;
const portable = image => ({ id: image.id, mimeType: image.mimeType, sha256: image.sha256, dataUrl: image.dataUrl });
const keyFor = item => JSON.stringify([item.ownerDeviceId, item.scopeId, item.id, item.revision]);

export function createTaskCenterImages({ directory, localDevice, store, fetchRemoteBundle } = {}) {
  const cache = createTaskImageStorage(directory), known = new Set(), transfers = new Map(), prepared = new Map();
  let nativeConnection = null, syncPromise = null, syncedAt = 0;
  const renderer = async (connection, operation, payload) => {
    if (!connection?.evaluate) throw imageFailure('来源设备的原生窗口尚未连接，图片未同步');
    return connection.evaluate(`(async () => {
      if (location.href !== 'app://-/index.html') throw new Error('任务图片只能在本机原生窗口读取');
      const tools = window.__cccTaskCenterImageTools ||= ${rendererSource}();
      return tools[${JSON.stringify(operation)}](${JSON.stringify(payload)});
    })()`);
  };
  const capture = async (connection, input) => {
    const refs = imageRefs(input);
    if (!refs.length) return;
    const missing = [];
    for (const id of refs) if (!await cache.read(localDevice.id, id)) missing.push(id);
    if (!missing.length) { refs.forEach(id => known.add(id)); return; }
    const values = await renderer(connection, 'exportImages', missing.map(id => ({ type: 'heldImage', id })));
    const images = checkedBundle({ version: 1, images: values }, missing, { digestRequired: false });
    for (const image of images) { await cache.write(localDevice.id, image); known.add(image.id); }
  };
  const sync = async connection => {
    nativeConnection = connection;
    if (syncPromise) return syncPromise;
    if (Date.now() - syncedAt < 10_000) return;
    syncPromise = (async () => {
      const errors = [];
      for (const scope of await store.listScopes()) {
        for (const item of scope.items) {
          try {
            const missing = imageRefs(item.input).filter(id => !known.has(id));
            if (missing.length) await capture(connection, missing.map(id => ({ type: 'heldImage', id })));
          } catch (error) { errors.push({ scopeId: scope.scopeId, id: item.id, message: error.message }); }
        }
      }
      syncedAt = Date.now();
      return { errors };
    })().finally(() => { syncPromise = null; });
    return syncPromise;
  };
  const prepareAssignment = async ({ item }) => {
    if (!imageRefs(item.input).length) return;
    await capture(nativeConnection, item.input);
    const images = await Promise.all(imageRefs(item.input).map(id => cache.read(localDevice.id, id)));
    checkedBundle({ version: 1, images }, imageRefs(item.input));
  };
  const exportBundle = async ({ scopeId, id, expectedRevision }) => {
    validateTaskScopeId(scopeId);
    const scope = await store.readScope(scopeId), item = scope.items.find(value => value.id === id);
    if (!item) throw taskCenterError('TASK_NOT_FOUND', '原任务不存在', 404);
    if (typeof expectedRevision !== 'string' || taskRevision(item) !== expectedRevision) throw taskCenterError('TASK_CONFLICT', '任务已变化，请刷新后同步图片', 409);
    const refs = imageRefs(item.input);
    await capture(nativeConnection, item.input);
    const images = checkedBundle({ version: 1, images: await Promise.all(refs.map(ref => cache.read(localDevice.id, ref))) }, refs);
    const current = (await store.readScope(scopeId)).items.find(value => value.id === id);
    if (!current || taskRevision(current) !== expectedRevision) throw taskCenterError('TASK_CONFLICT', '任务已变化，请刷新后同步图片', 409);
    return { version: 1, images: images.map(portable) };
  };
  const loadRemote = async item => {
    const refs = imageRefs(item.input), cached = await Promise.all(refs.map(id => cache.read(item.ownerDeviceId, id)));
    if (cached.every(Boolean)) return checkedBundle({ version: 1, images: cached }, refs);
    if (typeof fetchRemoteBundle !== 'function') throw imageFailure('来源设备暂不可用，图片未同步');
    const images = checkedBundle(await fetchRemoteBundle(item), refs);
    for (const image of images) await cache.write(item.ownerDeviceId, image);
    return images;
  };
  const prepareRemoteInput = async (connection, item) => {
    const refs = imageRefs(item.input);
    if (!refs.length || item.ownerDeviceId === localDevice.id) return item.input;
    const key = keyFor(item), input = item.input.map(part => part.type === 'heldImage' ? { ...part, id: projectedImageId(item.ownerDeviceId, part.id) } : part);
    if (prepared.has(key) && await renderer(connection, 'hasImages', input)) return input;
    if (!transfers.has(key)) transfers.set(key, loadRemote(item).finally(() => transfers.delete(key)));
    const images = await transfers.get(key);
    await renderer(connection, 'importImages', images.map(image => ({ ...portable(image), id: projectedImageId(item.ownerDeviceId, image.id) })));
    if (!await renderer(connection, 'hasImages', input)) throw imageFailure('图片未完整写入本机，任务仍保留暂停状态');
    prepared.set(key, true);
    if (prepared.size > 2000) prepared.delete(prepared.keys().next().value);
    return input;
  };
  const originalInput = (item, input) => {
    const originals = new Set(imageRefs(item.input)), mapping = new Map([...originals].map(id => [projectedImageId(item.ownerDeviceId, id), id]));
    return normalizeChecklistInput(input).map(part => {
      if (part.type !== 'heldImage') return part;
      const id = mapping.get(part.id) || (originals.has(part.id) && part.id);
      if (!id) throw imageFailure('跨设备任务图片引用已变化，请刷新任务');
      return { type: 'heldImage', id };
    });
  };
  return { capture, sync, prepareAssignment, exportBundle, prepareRemoteInput, originalInput };
}
