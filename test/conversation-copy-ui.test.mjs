import test from 'node:test';
import assert from 'node:assert/strict';
import { mountConversationCopy } from '../public/features/project-sync/conversation-copy.js';

const source = { deviceId: 'air', path: '/source' }, target = { deviceId: 'pro', path: '/target' };
const threadId = '11111111-2222-4333-8444-555555555555', copiedId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const operationId = 'abcdefab-1234-4123-8123-abcdefabcdef', sharedProjectId = 'same-project';
const catalog = () => ({ status: 'ok', devices: [source, target].map(project => ({ device: { id: project.deviceId, name: project.deviceId },
  status: 'connected', projects: [{ path: project.path, name: 'App', sharedProjectId }] })) });
const thread = () => ({ threadId, title: '验收会话', status: 'completed' });
const preview = overrides => ({ status: 'ok', source, target, token: 'one-use-token', operationId,
  expiresAt: new Date(Date.now() + 60000).toISOString(), thread: { ...thread(), sha256: 'a'.repeat(64), bytes: 1024 }, ...overrides });
const verified = overrides => ({ status: 'ok', verified: true, targetThreadId: copiedId, operationId, target, path: target.path, title: '验收会话副本', note: '', ...overrides });
const response = (body, ok = true) => ({ ok, json: async () => body });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

class Node {
  constructor() { this.value = ''; this.textContent = ''; this.hidden = false; this.disabled = false; this.children = []; this.handlers = new Map(); }
  append(node) { this.children.push(node); }
  replaceChildren() { this.children = []; this.value = ''; }
  addEventListener(name, handler) { this.handlers.set(name, handler); }
  async fire(name) { return this.handlers.get(name)?.(); }
}
function dom() {
  const nodes = new Map(['source', 'thread', 'target', 'note', 'operations', 'list-note', 'status', 'error', 'preview', 'refresh', 'check', 'copy', 'resume', 'recovery'].map(name => [name, new Node()]));
  return { nodes, documentRef: { querySelector: selector => nodes.get(selector.slice('#conversation-'.length)), createElement: () => new Node() } };
}
async function setup(t, handler, options = {}) {
  const fake = dom(), calls = [];
  const controller = mountConversationCopy({ documentRef: fake.documentRef, fetchImpl: async (url, init) => {
    const call = { url, body: init.body && JSON.parse(init.body), signal: init.signal }; calls.push(call);
    if (handler) { const result = await handler(call); if (result) return result; }
    if (url.endsWith('/catalog')) return response(catalog());
    if (url.endsWith('/conversation-list')) return response({ status: 'ok', conversations: [thread()] });
    if (url.endsWith('/conversation-operations')) return response({ status: 'ok', operations: [] });
    if (url.endsWith('/conversation-preflight')) return response(preview());
    return response(verified());
  }, ...options });
  t.after(() => controller.dispose()); await controller.ready;
  return { ...fake, controller, calls, node: name => fake.nodes.get(name) };
}
async function select(f) {
  f.node('source').value = JSON.stringify(source); await f.node('source').fire('change');
  f.node('thread').value = threadId; await f.node('thread').fire('change');
  f.node('target').value = JSON.stringify(target); await f.node('target').fire('change');
}

test('missing selections prevent preflight and only linked remote targets appear', async t => {
  const f = await setup(t); assert.equal(await f.controller.preflight(), false);
  assert.match(f.node('error').textContent, /请选择/);
  assert.equal(f.calls.filter(call => call.url.endsWith('/conversation-preflight')).length, 0);
  f.node('source').value = JSON.stringify(source); await f.node('source').fire('change');
  assert.deepEqual(f.node('target').children.map(node => node.value), ['', JSON.stringify(target)]);
});

test('ended conversations remain selectable while blocked records explain the reason', async t => {
  const active = { threadId: copiedId, title: '正在工作', status: 'active', eligible: false, reason: '运行中的会话不能复制' };
  const f = await setup(t, call => call.url.endsWith('/conversation-list') ? response({ status: 'ok', conversations: [thread(), active] }) : null);
  await select(f); assert.equal(f.node('thread').children[1].disabled, false);
  assert.equal(f.node('thread').children[2].disabled, true); assert.match(f.node('thread').children[2].textContent, /运行中的会话/);
  f.node('thread').value = copiedId; await f.node('thread').fire('change');
  assert.equal(await f.controller.preflight(), false); assert.match(f.node('error').textContent, /运行中的会话/);
});

test('preflight binds selected direction and verification shows the independent destination UUID', async t => {
  const f = await setup(t); await select(f);
  f.node('note').value = '检查回归'; await f.node('note').fire('input');
  assert.equal(await f.controller.preflight(), true); assert.equal(f.controller.getState().canExecute, true);
  const check = f.calls.find(call => call.url.endsWith('/conversation-preflight'));
  assert.deepEqual(check.body, { source, target, threadId, note: '检查回归' });
  assert.match(f.node('preview').textContent, /不自动启动任务/);
  assert.equal('token' in f.controller.getState().preview, false);
  assert.equal(await f.controller.execute(), true); assert.equal(f.controller.getState().result.targetThreadId, copiedId);
  assert.match(f.node('status').textContent, /独立会话 ID/); assert.match(f.node('status').textContent, new RegExp(copiedId));
  assert.equal(f.node('resume').hidden, true); assert.equal(f.node('recovery').hidden, true);
  assert.equal(await f.controller.execute(), false);
  assert.equal(f.calls.filter(call => call.url.endsWith('/conversation-execute')).length, 1);
  assert.deepEqual(f.calls.find(call => call.url.endsWith('/conversation-execute')).body, { token: 'one-use-token' });
});

test('selection or note changes immediately invalidate preview and late responses cannot restore it', async t => {
  const gate = deferred(); let hold = false;
  const f = await setup(t, call => call.url.endsWith('/conversation-preflight') && hold ? gate.promise : null); await select(f);
  await f.controller.preflight(); f.node('note').value = '另一个交接说明'; await f.node('note').fire('input');
  assert.equal(f.controller.getState().canExecute, false); assert.equal(f.node('copy').hidden, true);
  hold = true; const pending = f.controller.preflight();
  f.node('target').value = ''; await f.node('target').fire('change');
  gate.resolve(response(preview())); await pending;
  assert.equal(f.controller.getState().preview, null); assert.equal(f.controller.getState().canExecute, false);
});

test('unknown execute results retain the planned operation and resume verifies the same copy without replay', async t => {
  let writes = 0;
  const f = await setup(t, call => {
    if (call.url.endsWith('/conversation-execute')) { writes++; throw Error('连接中断，结果未确认'); }
    return null;
  });
  await select(f); await f.controller.preflight(); assert.equal(await f.controller.execute(), false);
  assert.equal(writes, 1); assert.equal(f.controller.getState().canExecute, false);
  assert.deepEqual(f.controller.getState().recovery, { operationId, target, threadId });
  assert.equal(f.node('resume').hidden, false); assert.match(f.node('recovery').textContent, /不会重新发起复制/);
  assert.equal(await f.controller.execute(), false); assert.equal(await f.controller.preflight(), false); assert.equal(writes, 1);
  await f.controller.refresh(); assert.equal(f.node('resume').hidden, false);
  assert.equal(await f.controller.resume(), true);
  assert.deepEqual(f.calls.find(call => call.url.endsWith('/conversation-resume')).body, { deviceId: 'pro', operationId });
  assert.equal(f.controller.getState().recovery, null); assert.equal(writes, 1);
});

test('explicit unconfirmed reply remains recoverable and malformed verification is never called success', async t => {
  for (const value of [verified({ verified: false, message: '原生登记尚未确认' }), verified({ targetThreadId: threadId }),
    verified({ operationId: copiedId }), verified({ path: '/other' }), verified({ target: { ...target, deviceId: 'other' } })]) {
    const f = await setup(t, call => call.url.endsWith('/conversation-execute') ? response(value) : null);
    await select(f); await f.controller.preflight(); assert.equal(await f.controller.execute(), false);
    assert.equal(f.controller.getState().result, null); assert.equal(f.controller.getState().recovery.operationId, operationId);
    assert.equal(f.node('resume').hidden, false); assert.ok(f.node('error').textContent);
  }
});

test('busy execution locks every field and action and cannot be repeated', async t => {
  const gate = deferred(), f = await setup(t, call => call.url.endsWith('/conversation-execute') ? gate.promise : null);
  await select(f); await f.controller.preflight(); const pending = f.controller.execute();
  for (const name of ['source', 'thread', 'target', 'note', 'operations', 'refresh', 'check', 'copy', 'resume']) assert.equal(f.node(name).disabled, true, name);
  assert.equal(await f.controller.execute(), false); assert.equal(await f.controller.refresh(), false);
  gate.resolve(response(verified())); await pending;
  for (const name of ['source', 'thread', 'target', 'note', 'operations', 'refresh', 'check', 'copy', 'resume']) assert.equal(f.node(name).disabled, false, name);
  assert.equal(f.calls.filter(call => call.url.endsWith('/conversation-execute')).length, 1);
});

test('expired and mismatched previews cannot grant copying approval', async t => {
  for (const data of [preview({ expiresAt: new Date(0).toISOString() }), preview({ source: { ...source, path: '/other' } }),
    preview({ thread: { ...preview().thread, sha256: 'invalid' } }), preview({ operationId: 'invalid' })]) {
    const f = await setup(t, call => call.url.endsWith('/conversation-preflight') ? response(data) : null); await select(f);
    assert.equal(await f.controller.preflight(), false); assert.equal(f.controller.getState().canExecute, false);
  }
  let current = Date.now();
  const f = await setup(t, null, { now: () => current }); await select(f); await f.controller.preflight(); current += 120000;
  assert.equal(await f.controller.execute(), false); assert.equal(f.calls.filter(call => call.url.endsWith('/conversation-execute')).length, 0);
});

test('execute timeout exits a hanging transport, keeps recovery and never resends', async t => {
  const f = await setup(t, call => call.url.endsWith('/conversation-execute') ? new Promise(() => {}) : null, { requestTimeoutMs: 5 });
  await select(f); await f.controller.preflight(); assert.equal(await f.controller.execute(), false);
  assert.equal(f.calls.find(call => call.url.endsWith('/conversation-execute')).signal.aborted, true);
  assert.equal(f.controller.getState().busy, false); assert.equal(f.controller.getState().recovery.operationId, operationId);
  assert.match(f.node('error').textContent, /不会自动重试/); assert.equal(await f.controller.execute(), false);
  assert.equal(f.calls.filter(call => call.url.endsWith('/conversation-execute')).length, 1);
});

test('a fresh page discovers durable incomplete operations and resumes without a new preflight', async t => {
  const saved = { operationId, path: target.path, sourceThreadId: threadId, title: '保留的会话副本', note: '继续验收', status: 'needs-review' };
  const handler = call => call.url.endsWith('/conversation-operations') ? response({ status: 'ok', operations: [saved,
    { ...saved, operationId: copiedId, path: '/other' }, { ...saved, operationId: threadId, status: 'completed' },
    { ...saved, operationId: 'bbbbbbbb-1234-4123-8123-cccccccccccc', status: 'prepared' }] }) : null;
  const f = await setup(t, handler);
  f.node('source').value = JSON.stringify(source); await f.node('source').fire('change');
  f.node('target').value = JSON.stringify(target); await f.node('target').fire('change');
  assert.deepEqual(f.calls.find(call => call.url.endsWith('/conversation-operations')).body, { deviceId: target.deviceId });
  assert.deepEqual(f.node('operations').children.map(node => node.value), ['', operationId]);
  f.node('operations').value = operationId; await f.node('operations').fire('change');
  assert.equal(f.node('resume').hidden, false); assert.equal(f.controller.getState().preview, null);
  assert.equal(await f.controller.resume(), true); assert.equal(f.controller.getState().result.targetThreadId, copiedId);
  assert.equal(f.calls.filter(call => call.url.endsWith('/conversation-preflight') || call.url.endsWith('/conversation-execute')).length, 0);
  assert.equal(f.node('operations').children.length, 1); assert.equal(f.node('resume').hidden, true);
});

test('a fresh page resumes an authorized prepared operation while hiding preflight-only prepared records', async t => {
  const saved = { operationId, path: target.path, sourceThreadId: threadId, title: '已授权的会话副本', note: '', status: 'prepared', resumeEligible: true };
  const f = await setup(t, call => call.url.endsWith('/conversation-operations') ? response({ status: 'ok', operations: [saved,
    { ...saved, operationId: threadId, resumeEligible: false }, { ...saved, operationId: copiedId, resumeEligible: undefined }] }) : null);
  f.node('source').value = JSON.stringify(source); await f.node('source').fire('change');
  f.node('target').value = JSON.stringify(target); await f.node('target').fire('change');
  assert.deepEqual(f.node('operations').children.map(node => node.value), ['', operationId]);
  f.node('operations').value = operationId; await f.node('operations').fire('change');
  assert.equal(f.node('resume').hidden, false); assert.equal(await f.controller.resume(), true);
  assert.deepEqual(f.calls.find(call => call.url.endsWith('/conversation-resume')).body, { deviceId: target.deviceId, operationId });
  assert.equal(f.controller.getState().result.targetThreadId, copiedId); assert.equal(f.controller.getState().recovery, null);
  assert.equal(f.calls.filter(call => call.url.endsWith('/conversation-preflight') || call.url.endsWith('/conversation-execute')).length, 0);
});

test('a definitive not-started execute error removes recovery but still consumes approval without replay', async t => {
  const f = await setup(t, call => call.url.endsWith('/conversation-execute') ? response({ status: 'error', message: '源项目发生变化',
    details: { applyStarted: false, ignoredPayload: 'private data must not enter state' } }, false) : null);
  await select(f); await f.controller.preflight(); assert.equal(await f.controller.execute(), false);
  assert.equal(f.controller.getState().recovery, null); assert.equal(f.controller.getState().canExecute, false);
  assert.equal(f.node('resume').hidden, true); assert.match(f.node('error').textContent, /目标尚未开始复制.*重新检查/);
  assert.doesNotMatch(JSON.stringify(f.controller.getState()), /ignoredPayload|private data/);
  assert.equal(await f.controller.execute(), false);
  assert.equal(f.calls.filter(call => call.url.endsWith('/conversation-execute')).length, 1);
  assert.equal(await f.controller.preflight(), true);
  assert.equal(f.calls.filter(call => call.url.endsWith('/conversation-preflight')).length, 2);
  assert.equal(f.calls.filter(call => call.url.endsWith('/conversation-execute')).length, 1);
});

test('execute errors with started or unknown details retain recovery and cannot be preflighted again', async t => {
  for (const details of [undefined, { applyStarted: true }, { applyStarted: 'false' }]) {
    const f = await setup(t, call => call.url.endsWith('/conversation-execute') ? response({ status: 'error', message: '复制结果未确认', details }, false) : null);
    await select(f); await f.controller.preflight(); assert.equal(await f.controller.execute(), false);
    assert.equal(f.controller.getState().recovery.operationId, operationId); assert.equal(f.node('resume').hidden, false);
    assert.equal(await f.controller.preflight(), false); assert.equal(await f.controller.execute(), false);
    assert.equal(f.calls.filter(call => call.url.endsWith('/conversation-execute')).length, 1);
  }
});

test('notes beyond 2000 characters are rejected before transport while the accepted boundary is preserved', async t => {
  const f = await setup(t); await select(f);
  f.node('note').value = '交'.repeat(2001); await f.node('note').fire('input');
  assert.equal(await f.controller.preflight(), false); assert.match(f.node('error').textContent, /最多 2000 字/);
  assert.equal(f.calls.filter(call => call.url.endsWith('/conversation-preflight')).length, 0);
  f.node('note').value = '交'.repeat(2000); await f.node('note').fire('input');
  assert.equal(await f.controller.preflight(), true);
  assert.equal(f.calls.find(call => call.url.endsWith('/conversation-preflight')).body.note.length, 2000);
});
