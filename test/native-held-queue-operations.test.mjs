import test from 'node:test';
import assert from 'node:assert/strict';
import { pauseNativeQueuedItem } from '../src/native-held-queue-operations.mjs';

const THREAD = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

test('pausing keeps the safety copy when queue deletion succeeded but listing fails', async () => {
  let held = [], busy = false, migrated = 0;
  const context = {
    busy: () => busy, threadId: () => THREAD, setBusy: value => { busy = value; },
    readEditableText: () => '内容', heldFor: () => held,
    summarize: () => '内容', writeHeld: (_, items) => { held = items; },
    imageTools: { captureQueueInput: async input => input, release: async () => {} },
    request: async method => { assert.equal(method, 'thread/queue/delete'); return { deleted: true }; },
    migrateLegacyTodos: () => { migrated++; }, listQueue: async () => { throw new Error('listing failed'); },
    warn() {}, setServerItems() {}, setEditing() {}
  };
  await pauseNativeQueuedItem(THREAD, { id: 'queue-a', input: [{ type: 'text', text: '内容' }] }, false, context);
  assert.equal(held.length, 1);
  assert.equal(held[0].origin, 'paused-queue');
  assert.equal(migrated, 1);
  assert.equal(busy, false);
});
