import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeHeldImageTools } from '../src/native-held-image-tools.mjs';
import { saveNativeHeldDraft } from '../src/native-held-draft-save.mjs';
import { summarizeNativeHeldMessage } from '../src/native-held-message-summary.mjs';

const png = () => new Blob([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0])], { type: 'image/png' });
const fixture = () => {
  const blobs = new Map();
  const image = { src: 'blob:composer-image' };
  const editor = { closest: () => ({ querySelectorAll: () => [image] }) };
  const tools = createNativeHeldImageTools({
    store: { put: async (id, blob) => blobs.set(id, blob), get: async (id) => blobs.get(id), delete: async (id) => blobs.delete(id) },
    fetchImage: async () => ({ ok: true, blob: async () => png() }),
    toDataUrl: async (blob) => `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`
  });
  return { blobs, editor, tools };
};

test('held image capture survives hydration and cleans up only after release', async () => {
  const { blobs, editor, tools } = fixture();
  const refs = await tools.capture(editor, 'held-1');
  assert.deepEqual(refs, [{ type: 'heldImage', id: 'held-1:0' }]);
  assert.equal(blobs.size, 1);
  const input = [{ type: 'text', text: '看看图片' }, ...refs];
  assert.equal(summarizeNativeHeldMessage(input), '看看图片 · 图片 1 张');
  assert.match((await tools.hydrate(input))[1].url, /^data:image\/png;base64,/);
  await tools.release(input);
  assert.equal(blobs.size, 0);
  await assert.rejects(() => tools.hydrate(input), /已丢失或损坏/);
});

test('image-only draft is saved before text clearing; failure keeps composer untouched', async () => {
  const { editor, tools, blobs } = fixture();
  let items = [], cleared = 0, warning = '', busy = false;
  const base = {
    threadId: () => 'thread-1', editor, readText: () => '', imageTools: tools,
    heldFor: () => items, writeHeld: (_, next) => { items = next; }, summarize: summarizeNativeHeldMessage,
    clearText: () => { cleared += 1; return true; }, setBusy: (value) => { busy = value; },
    setOpen: () => {}, setWarning: (value) => { warning = value; }, render: () => {}, updateButton: () => {}
  };
  await saveNativeHeldDraft(base);
  assert.equal(items.length, 1);
  assert.equal(items[0].summary, '图片 1 张');
  assert.equal(cleared, 0);
  assert.equal(busy, false);
  assert.match(warning, /原输入框图片仍在/);
  assert.equal(blobs.size, 1);
  await saveNativeHeldDraft({ ...base, writeHeld: () => { throw new Error('storage full'); } });
  assert.equal(items.length, 1);
  assert.match(warning, /storage full/);
  assert.equal(blobs.size, 1);
});

test('unsupported image is rejected without creating a held todo', async () => {
  const editor = { closest: () => ({ querySelectorAll: () => [{ src: 'blob:bad' }] }) };
  const tools = createNativeHeldImageTools({
    store: { put: async () => assert.fail('must not persist'), get: async () => undefined, delete: async () => {} },
    fetchImage: async () => ({ ok: true, blob: async () => new Blob(['not an image']) })
  });
  await assert.rejects(() => tools.capture(editor, 'held-2'), /仅支持/);
});
