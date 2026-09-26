import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerminalTasks } from '../public/features/terminal/tasks.js';

const conversation = { id: 'stable-conversation', deviceId: 'local' };
const makeItem = (id, fields = {}) => ({ id, key: id, ownerDeviceId: 'local', scopeId: 'general', source: 'checklist', text: id, revision: 'r1', done: false, ...fields });
function harness(initial = []) {
  let items = [...initial], draft = '', next = 0, failures = new Map();
  const calls = [];
  const request = async (url, options) => {
    if (!options) return { version: 1, localDeviceId: 'local', devices: [{ device: { id: 'local' }, status: 'connected', supportedProviders: ['terminal'], items: items.map(item => ({ ...item })) }] };
    const body = options.body; calls.push(body);
    if (failures.get(body.type) === 'before') { failures.delete(body.type); throw Error('failed before'); }
    let item = items.find(value => value.id === body.id);
    if (body.type === 'create') { item ||= makeItem(body.id, { text: body.text }); items = [...items.filter(value => value.id !== item.id), item]; }
    else {
      assert.equal(body.expectedRevision, item.revision);
      if (body.type === 'assign') item = { ...item, assignedProvider: body.assignedProvider, assignedDeviceId: body.assignedDeviceId, assignedThreadId: body.assignedThreadId };
      if (body.type === 'return') item = { ...item, assignedProvider: null, assignedDeviceId: null, assignedThreadId: null };
      if (body.type === 'complete') item = { ...item, done: true };
      item = { ...item, revision: `${item.revision}+` }; items = items.map(value => value.id === item.id ? item : value);
    }
    if (failures.get(body.type) === 'after') { failures.delete(body.type); throw Error('lost receipt'); }
    return { applied: true, requestId: body.requestId, item };
  };
  const stored = new Map(), storage = { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) };
  const create = () => createTerminalTasks({ request, getConversation: () => conversation, getDraft: () => draft, setDraft: value => { draft = value; }, uuid: () => `id-${++next}`, storage });
  let tasks = create();
  return { get tasks() { return tasks; }, reload: () => { tasks = create(); }, calls, fail: (type, when) => failures.set(type, when), setDraft: value => { draft = value; }, draft: () => draft };
}

test('save creates and assigns to stable terminal identity before clearing draft', async () => {
  const h = harness(); h.setDraft('shared task');
  assert.equal(await h.tasks.save(), true);
  assert.equal(h.draft(), '');
  assert.deepEqual(h.calls.map(item => item.type), ['create', 'assign']);
  assert.equal(h.calls[1].assignedProvider, 'terminal');
  assert.equal(h.calls[1].assignedThreadId, conversation.id);
  assert.equal(h.tasks.snapshot().assigned.length, 1);
});

test('failed assignment retries saved task without a duplicate and preserves a newer draft', async () => {
  const h = harness(); h.setDraft('old draft'); h.fail('assign', 'before');
  assert.equal(await h.tasks.save(), false); assert.equal(h.draft(), 'old draft');
  h.setDraft('new draft');
  assert.equal(await h.tasks.save(), true); assert.equal(h.draft(), 'new draft');
  assert.equal(h.calls.filter(item => item.type === 'create').length, 1);
  assert.equal(h.tasks.snapshot().assigned[0].text, 'old draft');
});

test('lost create or assignment receipts recover by owner readback without repeated mutation', async () => {
  for (const type of ['create', 'assign']) {
    const h = harness(); h.setDraft('recover'); h.fail(type, 'after');
    assert.equal(await h.tasks.save(), false); assert.equal(h.draft(), 'recover');
    assert.equal(await h.tasks.save(), true); assert.equal(h.draft(), '');
    assert.equal(h.calls.filter(item => item.type === type).length, 1);
  }
});

test('claim remains paused, insertion protects drafts, complete and return use same shared authority', async () => {
  const h = harness([makeItem('one'), makeItem('two')]); await h.tasks.load();
  assert.equal(await h.tasks.mutate('assign', 'one'), true);
  assert.equal(h.draft(), '');
  h.setDraft('keep'); assert.equal(h.tasks.insert('one'), false); assert.equal(h.draft(), 'keep');
  h.setDraft(''); assert.equal(h.tasks.insert('one'), true); assert.equal(h.draft(), 'one');
  assert.equal(await h.tasks.mutate('complete', 'one'), true);
  assert.equal(h.tasks.snapshot().assigned.length, 0);
  await h.tasks.mutate('assign', 'two'); await h.tasks.mutate('return', 'two');
  assert.equal(h.tasks.snapshot().inbox.length, 1);
  assert.ok(h.calls.every(item => !['delivered', 'send'].includes(item.type)));
});

test('provider identity prevents Codex assignment leakage and images cannot be claimed', async () => {
  const h = harness([makeItem('native', { assignedProvider: 'codex', assignedThreadId: conversation.id, assignedDeviceId: 'local' }), makeItem('image', { attachmentCount: 1, input: [{ type: 'localImage', path: '/image.png' }] })]);
  await h.tasks.load();
  assert.equal(h.tasks.snapshot().assigned.length, 0);
  assert.equal(await h.tasks.mutate('assign', 'image'), false);
  assert.match(h.tasks.snapshot().error, /图片/u);
  assert.equal(h.calls.length, 0);
});


test('partial save receipt survives iframe replacement without creating a second task', async () => {
  const h = harness(); h.setDraft('restore across tab return'); h.fail('assign', 'before');
  assert.equal(await h.tasks.save(), false);
  h.reload();
  assert.equal(await h.tasks.save(), true);
  assert.equal(h.calls.filter(item => item.type === 'create').length, 1);
  assert.equal(h.draft(), '');
});
