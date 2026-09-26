import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { resumeAssignedTask } from '../src/native-assigned-checklist-tasks.mjs';
import { createChecklistDeliveryBridge } from '../src/native-checklist-delivery.mjs';
import { createNativeChecklistNewThreadClaim } from '../src/native-checklist-new-thread-claim.mjs';
import { syncProjectChecklist } from '../src/project-checklist-sync.mjs';
import { createNativeChecklistTaskRow } from '../src/native-checklist-task-row.mjs';

const thread = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const task = { id: 'federated-task', text: '任务', sourceRef: { ownerDeviceId: 'windows', scopeId: 'a'.repeat(64), id: 'task' }, expectedRevision: 'before', sourceConnected: true };
const reservation = { token: 'token', requestId: 'request-1', assignedDeviceId: 'mac', assignedThreadId: thread };
function fixture(options = {}) {
  const records = new Map(), calls = [], warnings = []; let serial = 0, current = true, locked = false;
  const storage = { getItem: key => records.get(key) || null, setItem: (key, value) => records.set(key, value), removeItem: key => records.delete(key) };
  const bridge = {
    prepareAssignedTask: async (...args) => { calls.push(['prepare', ...args]); return { revision: 'reserved', deliveryReservation: reservation }; },
    completeAssignedTask: (...args) => { calls.push(['delivered', ...args]); return false; },
    releaseAssignedTask: async (...args) => { calls.push(['release', ...args]); }, ...options.bridge
  };
  const locks = { async request(_, __, callback) { if (locked) return callback(null); locked = true; try { return await callback({}); } finally { locked = false; } } };
  const context = { threadId: thread, busy: () => false, setBusy() {}, isCurrent: () => current, ownsTask: () => true,
    hydrateInput: async value => value.input, request: async (...args) => calls.push(['queue', ...args]), removeAssigned() {}, listQueue: async () => [], setServerItems() {}, setWarning: value => warnings.push(value), ...options.context };
  const run = vm.runInNewContext(`(${resumeAssignedTask.toString()})`, { window: { __cccProjectChecklist: bridge }, localStorage: storage, crypto: { randomUUID: () => 'request-' + ++serial }, navigator: { locks } });
  return { run: (value = task) => run(value, context), records, calls, warnings, storage, locks, bridge, navigate: () => { current = false; } };
}

test('offline source and broken attachment fail before reservation or native queue', async () => {
  const h = fixture(); await h.run({ ...task, readOnly: true, sourceConnected: false });
  assert.deepEqual(h.calls, []);
  const badImage = fixture({ context: { hydrateInput: async () => { throw Error('图片缺失'); } } });
  await badImage.run({ ...task, input: [{ type: 'heldImage', id: 'missing' }] });
  assert.deepEqual(badImage.calls, []); assert.equal(badImage.records.size, 0);
});

test('known revision conflict clears verifying receipt so a refreshed task can be attempted', async () => {
  const h = fixture({ bridge: { prepareAssignedTask: async () => { throw Object.assign(Error('版本冲突'), { code: 'REVISION_CONFLICT' }); } } });
  await h.run(); assert.equal(h.records.size, 0); assert.deepEqual(h.calls, []);
});

test('queue success followed by unsaved delivery never sends the message again', async () => {
  const h = fixture(); await h.run(); await h.run();
  assert.equal(h.calls.filter(call => call[0] === 'queue').length, 1);
  assert.equal(h.calls.filter(call => call[0] === 'delivered').length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.find(call => call[0] === 'delivered')[4])), { expectedRevision: 'reserved', reservationToken: 'token' });
  assert.equal(JSON.parse([...h.records.values()][0]).phase, 'queued');
});

test('uncertain native submission is retained and cannot be repeated after renderer retry', async () => {
  let requests = 0;
  const h = fixture({ context: { request: async () => { requests++; throw Error('native timeout'); } } });
  await h.run(); await h.run();
  assert.equal(requests, 1); assert.equal(JSON.parse([...h.records.values()][0]).phase, 'submitting');
  assert.match(h.warnings.at(-1), /待核对/);
});

test('navigation after reservation releases only the verified unsubmitted reservation', async () => {
  const h = fixture(); h.bridge.prepareAssignedTask = async () => { h.navigate(); return { revision: 'reserved', deliveryReservation: reservation }; };
  await h.run();
  assert.equal(h.calls.filter(call => call[0] === 'queue').length, 0);
  assert.equal(h.calls.filter(call => call[0] === 'release').length, 1);
  assert.equal(h.records.size, 0);
});

test('confirmed reservation recovers a pre-submission interruption under a cross-window lock', async () => {
  const h = fixture();
  h.storage.setItem('ccc.checklist.delivery.v1:' + thread + ':' + task.id, JSON.stringify({ phase: 'verifying', clientUserMessageId: 'request-1', text: task.text, expectedRevision: 'before' }));
  const confirmed = { ...task, expectedRevision: 'reserved', readOnly: true, deliveryReservation: reservation };
  await Promise.all([h.run(confirmed), h.run(confirmed)]);
  assert.equal(h.calls.filter(call => call[0] === 'prepare').length, 0);
  assert.equal(h.calls.filter(call => call[0] === 'queue').length, 1);
});

test('a reopened task with a new source revision starts a new delivery cycle', async () => {
  const h = fixture(); await h.run();
  await h.run({ ...task, expectedRevision: 'reopened-and-reassigned' });
  assert.equal(h.calls.filter(call => call[0] === 'queue').length, 2);
  assert.equal(h.calls.filter(call => call[0] === 'prepare').length, 2);
});

test('confirmed unsent release timeout can recover from source readback without being treated as an uncertain send', async () => {
  const h = fixture();
  h.storage.setItem('ccc.checklist.delivery.v1:' + thread + ':' + task.id, JSON.stringify({ phase: 'releasing', clientUserMessageId: 'request-1', releaseRequestId: 'release-1', text: task.text, expectedRevision: 'reserved', sourceRevisionBefore: 'before', reservationToken: 'token' }));
  await h.run({ ...task, expectedRevision: 'after-release' });
  assert.equal(h.calls.filter(call => call[0] === 'queue').length, 1);
  assert.equal(h.calls.filter(call => call[0] === 'prepare').length, 1);
});

test('delivery bridge returns reserved identity and preserves rejection codes', async () => {
  let enqueued;
  const bridge = createChecklistDeliveryBridge({ readItems: () => [{ ...task, done: false, assignedThreadId: thread }], enqueue: (item, requestId) => { enqueued = { item, requestId }; return requestId; }, signal() {} });
  const pending = bridge.prepare(task.id, thread, task.text, 'request-1');
  assert.equal(enqueued.item.expectedRevision, 'before');
  bridge.accept({ acknowledged: ['request-1'], actionResults: [{ requestId: 'request-1', item: { revision: 'reserved', deliveryReservation: reservation } }] });
  assert.equal((await pending).deliveryReservation.token, 'token');
  const failed = bridge.prepare(task.id, thread, task.text, 'request-2');
  bridge.accept({ rejected: ['request-2'], rejectionErrors: [{ requestId: 'request-2', message: '任务冲突', code: 'REVISION_CONFLICT' }] });
  await assert.rejects(failed, { code: 'REVISION_CONFLICT' }); bridge.dispose();
});

test('sync serializes actions per source item and passes new revisions before sending dependent edits', async () => {
  const applied = [], results = [];
  const actions = [{ ...task, sourceRef: task.sourceRef, projectKey: 'general', type: 'upsert', requestId: 'edit-1' }, { ...task, projectKey: 'general', type: 'upsert', requestId: 'edit-2' }, { ...task, id: 'another', sourceRef: { ...task.sourceRef, id: 'another' }, projectKey: 'general', type: 'upsert', requestId: 'other' }];
  const connection = { async evaluate(code) {
    if (code.includes('location.href')) return true;
    if (code === 'window.__cccProjectChecklist?.packet()') return { projectKey: '', actions };
    if (code.startsWith('window.__cccProjectChecklist?.accept')) vm.runInNewContext(code, { window: { __cccProjectChecklist: { accept: value => results.push(value) } } });
  } };
  await syncProjectChecklist(connection, { async read() { return { items: [] }; }, async apply(action) { applied.push(action); return { requestId: action.requestId, item: { ...action.sourceRef, revision: 'next' } }; } });
  assert.deepEqual(applied.map(action => action.requestId), ['edit-1', 'other']);
  assert.equal(results[0].actionResults[0].previousRevision, 'before');
  assert.equal(results[0].actionResults[0].item.revision, 'next');
});

test('new-thread claim reserves first, releases known pre-send failure, and never labels delivery complete', async () => {
  const h = fixture(), actions = [], events = [];
  const create = vm.runInNewContext(`(${createNativeChecklistNewThreadClaim.toString()})`, { crypto: { randomUUID: () => 'request-new' }, navigator: { locks: h.locks } });
  const current = { ...task, done: false, assignedThreadId: null };
  const claim = create({ start: async () => { events.push('send'); return thread; }, prepare: async () => { events.push('reserve'); return { revision: 'reserved', deliveryReservation: { ...reservation, assignedThreadId: null } }; }, storage: h.storage,
    readTask: () => current, enqueue: item => { actions.push(item); return 'saved'; }, report() {}, showFailure: assert.fail });
  await Promise.all([claim.claim(current.id, () => current), claim.claim(current.id, () => current)]);
  assert.deepEqual(events, ['reserve', 'send']); assert.equal(actions[0].done, false); assert.equal(actions[0].executionState, 'delivered'); assert.equal(actions[0].reservationToken, 'token');
  h.records.clear(); events.length = 0;
  const failed = create({ start: async () => { throw Object.assign(Error('发送前校验失败'), { nativeNotSubmitted: true }); }, prepare: async () => ({ revision: 'reserved', deliveryReservation: reservation }), release: async () => events.push('release'), storage: h.storage,
    readTask: () => current, enqueue: assert.fail, report() {}, showFailure() {} });
  await failed.claim(current.id, () => current);
  assert.deepEqual(events, ['release']); assert.equal(h.records.size, 0);
});

test('new-thread recovery button is reachable only for this device saved pre-submission reservation', () => {
  let saved = JSON.stringify({ phase: 'verifying', requestId: 'request-1' }), claimed = 0;
  const rowFactory = vm.runInNewContext(`(${createNativeChecklistTaskRow.toString()})`, { localStorage: { getItem: () => saved } });
  const make = (tag, textContent) => ({ tag, textContent, dataset: {}, children: [], listeners: {}, append(...children) { this.children.push(...children); }, setAttribute() {}, addEventListener(name, callback) { this.listeners[name] = callback; } });
  const item = { ...task, readOnly: true, deliveryReservation: reservation };
  const params = { item, project: { key: 'general', claimNewThread: true }, loaded: 'general', make, drafts: new Map(), taskEditors: new Map(),
    createTaskEditor: () => ({ read: () => null, restoreFocus() {} }), appendTime() {}, searchRegister() {},
    newThreadClaim: { claim: (_, read) => { assert.equal(read(), item); claimed++; } } };
  const first = rowFactory(params).row.children[1];
  assert.equal(first.disabled, false); assert.equal(first.textContent, '继续领取'); first.listeners.click(); assert.equal(claimed, 1);
  saved = JSON.stringify({ phase: 'submitting', requestId: 'request-1' });
  assert.equal(rowFactory(params).row.children[1].disabled, true);
  saved = JSON.stringify({ phase: 'verifying', requestId: 'another-window-reservation' });
  assert.equal(rowFactory(params).row.children[1].disabled, true);
});
