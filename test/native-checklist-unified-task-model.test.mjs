import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeChecklistTaskModel, createNativeChecklistPasteImages } from '../src/native-checklist-unified-task.mjs';
import { normalizeChecklistInput } from '../src/project-checklist-input.mjs';

const thread = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const image = { type: 'heldImage', id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb:0' };

function modelFixture({ general = [], pending = [], held = {} } = {}) {
  const events = [], storage = { getItem: () => JSON.stringify(held), setItem: (_, value) => { Object.assign(held, JSON.parse(value)); } };
  const model = createNativeChecklistTaskModel({ generalKey: 'ccc:general-inbox:v1', heldKey: 'held', syncBinding: 'sync', documentRef: {}, localStorageRef: storage,
    windowRef: { sync() {}, Event: class {}, dispatchEvent: event => events.push(event) }, normalizeInput: normalizeChecklistInput,
    readThreadId: () => thread, readGeneralItems: () => general, readPending: () => pending,
    enqueueAction(item, projectKey) { pending.push({ ...item, projectKey, type: 'upsert' }); return true; }, setAssignedSnapshot() {}, onSaved() {} });
  return { model, general, pending, held, events };
}

test('composer todos, general tasks, and assigned projection share one id and image payload through return', () => {
  const h = modelFixture();
  h.model.createAssignedTask({ id: thread, threadId: thread, text: '保存的待办', input: [{ type: 'text', text: '保存的待办' }, image] });
  assert.deepEqual(h.model.tasksForThread(thread).map(item => item.id), [thread]);
  assert.deepEqual(h.model.tasksForThread(thread)[0].input[1], image);
  const created = h.pending[0];
  h.pending[0] = { ...created, assignedThreadId: null };
  assert.deepEqual(h.model.tasksForThread(thread), []);
  assert.equal(h.pending[0].id, thread);
  assert.deepEqual(h.pending[0].input[1], image);
});

test('legacy direct-saved todo is copied before acknowledgement and removed only afterward', () => {
  const old = { id: thread, origin: 'draft', heldAt: 1790000000000, input: [{ type: 'text', text: '旧待办' }, image] };
  const h = modelFixture({ held: { [thread]: [old] } });
  assert.equal(h.model.hasLegacyDrafts(), true);
  assert.equal(h.model.migrateLegacyDrafts(), '');
  assert.equal(h.held[thread].length, 1);
  const action = h.pending[0];
  assert.equal(action.assignedThreadId, thread);
  h.model.completeLegacySources([action]);
  assert.equal(h.held[thread].length, 0);
  assert.equal(h.events.length, 1);
});

test('paused native queue todo migrates with its identity and image, then clears only after acknowledgement', () => {
  const old = { id: thread, origin: 'paused-queue', heldAt: 1790000000000, input: [{ type: 'text', text: '暂停消息' }, image] };
  const h = modelFixture({ held: { [thread]: [old] } });
  assert.equal(h.model.hasLegacyDrafts(), true);
  assert.equal(h.model.migrateLegacyDrafts(), '');
  assert.equal(h.model.legacyTaskPending(old.id, thread), true);
  assert.equal(h.held[thread].length, 1);
  assert.equal(h.pending[0].id, old.id);
  assert.equal(h.pending[0].legacyHeldSource.origin, 'paused-queue');
  assert.deepEqual(h.pending[0].input, old.input);
  assert.equal(h.model.migrateLegacyDrafts(), '', 'retry does not duplicate the action');
  assert.equal(h.pending.length, 1);
  h.model.completeLegacySources([h.pending[0]]);
  assert.deepEqual(h.held[thread], []);
});

test('pasted image files enter the common held-image payload and remain until the task is consumed', async () => {
  let pasteHandler, stored = 0, changed = 0;
  const tools = { captureBlobs: async (files, id) => { stored++; return [{ type: 'heldImage', id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb:0' }]; }, release: async () => {} };
  const paste = createNativeChecklistPasteImages({ taskImages: tools, cryptoRef: { randomUUID: () => thread }, onError: assert.fail, onChange: () => changed++ });
  paste.bind({ addEventListener: (_, handler) => { pasteHandler = handler; } });
  let prevented = false;
  await pasteHandler({ clipboardData: { items: [{ type: 'image/png', getAsFile: () => new Blob(['x'], { type: 'image/png' }) }] }, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.deepEqual(normalizeChecklistInput([{ type: 'text', text: '贴图任务' }, ...paste.images()]), [{ type: 'text', text: '贴图任务' }, image]);
  assert.equal(stored, 1);
  paste.consume();
  assert.deepEqual(paste.images(), []);
  assert.ok(changed >= 2);
});
