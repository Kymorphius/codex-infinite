export function createNativeHeldImageTools({ store = null, fetchImage = globalThis.fetch, toDataUrl = null } = {}) {
  const databaseName = 'codex-control-console.native-held-images.v1';
  const storeName = 'images';
  let databasePromise = null;
  const database = () => {
    if (!databasePromise) databasePromise = new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) { reject(new Error('本机图片存储不可用')); return; }
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('无法打开本机图片存储'));
    });
    return databasePromise;
  };
  const transact = async (mode, action) => {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode), request = action(tx.objectStore(storeName));
      let value;
      if (request) request.onsuccess = () => { value = request.result; };
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(new Error('本机图片存储失败'));
      tx.onabort = () => reject(new Error('本机图片存储中断'));
    });
  };
  const storage = store || {
    put: (id, blob) => transact('readwrite', (table) => table.put(blob, id)),
    get: (id) => transact('readonly', (table) => table.get(id)),
    delete: (id) => transact('readwrite', (table) => table.delete(id))
  };
  const mimeFor = async (blob) => {
    const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return 'image/png';
    if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
    if (bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 56) return 'image/gif';
    if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
    return null;
  };
  const dataUrl = toDataUrl || ((blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('无法读取待办图片'));
    reader.readAsDataURL(blob);
  }));
  const images = (editor) => Array.from(editor?.closest?.('[data-composer-surface-variant]')?.querySelectorAll?.('img') || [])
    .filter((image) => Boolean(image.currentSrc || image.src));
  const refs = (input) => (Array.isArray(input) ? input : []).filter((part) => part?.type === 'heldImage' && typeof part.id === 'string');
  const release = async (input) => {
    const results = await Promise.allSettled(refs(input).map((part) => storage.delete(part.id)));
    if (results.some((result) => result.status === 'rejected')) throw new Error('待办图片清理失败');
  };
  const capture = async (editor, heldId) => {
    const candidates = images(editor);
    if (candidates.length > 8) throw new Error('每条待办最多保存 8 张图片');
    const blobs = [];
    let total = 0;
    try {
      for (const image of candidates) {
        const response = await fetchImage(image.currentSrc || image.src);
        if (!response?.ok) throw new Error('无法读取输入框图片');
        const blob = await response.blob();
        total += blob.size;
        if (!blob.size || blob.size > 8 * 1024 * 1024 || total > 24 * 1024 * 1024) throw new Error('图片为空或超过待办保存上限');
        blobs.push(blob);
      }
      return await captureBlobs(blobs, heldId);
    } catch (error) {
      throw error;
    }
  };
  const captureBlobs = async (blobs, heldId) => {
    if (!Array.isArray(blobs) || !blobs.length || blobs.length > 8 || typeof heldId !== 'string' || !/^[0-9a-f-]{36}$/i.test(heldId)) throw new Error('粘贴图片数量或任务标识无效');
    const saved = []; let total = 0;
    try {
      for (const blob of blobs) {
        if (!(blob instanceof Blob)) throw new Error('粘贴内容不是图片');
        total += blob.size;
        if (!blob.size || blob.size > 8 * 1024 * 1024 || total > 24 * 1024 * 1024) throw new Error('图片为空或超过待办保存上限');
        const mime = await mimeFor(blob);
        if (!mime) throw new Error('仅支持 PNG、JPEG、GIF 和 WebP 图片');
        const id = `${heldId}:${saved.length}`;
        await storage.put(id, new Blob([blob], { type: mime }));
        saved.push({ type: 'heldImage', id });
      }
      return saved;
    } catch (error) { await release(saved).catch(() => {}); throw error; }
  };
  const hydrate = async (input) => {
    const output = [];
    for (const part of input) {
      if (part?.type !== 'heldImage') { output.push(part); continue; }
      if (typeof part.id !== 'string') throw new Error('待办图片引用无效');
      const blob = await storage.get(part.id);
      if (!(blob instanceof Blob) || !(await mimeFor(blob))) throw new Error('待办图片已丢失或损坏，未加入发送队列');
      const url = await dataUrl(blob);
      if (typeof url !== 'string' || !url.startsWith('data:image/')) throw new Error('待办图片无法恢复，未加入发送队列');
      output.push({ type: 'image', url });
    }
    return output;
  };
  return { images, capture, captureBlobs, hydrate, release, count: (input) => refs(input).length };
}
