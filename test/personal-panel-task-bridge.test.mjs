import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePersonalPanelTaskList, personalPanelTaskMutation } from '../src/personal-panel-task-contract.mjs';
import { PersonalPanelTaskAdapter } from '../src/personal-panel-task-adapter.mjs';
import { createPersonalPanelTaskHttpHandler } from '../src/personal-panel-task-http.mjs';

const owner = { accountId: 'account-1', spaceId: 'space-1' };
const native = { version: 1, owner, tasks: [{ id: 'task-1', name: '真实任务', status: '待办', lane: 'todo', category: '工作', planDate: null, readOnly: false, revision: 'a'.repeat(64) }], nextCursor: null };

test('native task projection preserves owner, source status and revision without copying private detail', () => {
  const snapshot = normalizePersonalPanelTaskList({ ...native, tasks: [{ ...native.tasks[0], planText: '私人计划', unknown: 1 }] });
  assert.deepEqual(snapshot.owner, owner);
  assert.deepEqual(snapshot.tasks[0], { id: 'task-1', name: '真实任务', status: '待办', lane: 'todo', category: '工作', planDate: null, readOnly: false, revision: 'a'.repeat(64) });
  assert.throws(() => normalizePersonalPanelTaskList({ ...native, tasks: [{ ...native.tasks[0], lane: 'invented' }] }));
});

test('native status action uses exact owner/revision and completes through a dedicated operation', () => {
  const snapshot = normalizePersonalPanelTaskList(native);
  assert.deepEqual(personalPanelTaskMutation(snapshot, { owner, id: 'task-1', revision: 'a'.repeat(64), action: 'start' }), { op: 'task.update', owner, id: 'task-1', revision: 'a'.repeat(64), patch: { status: '进行中' } });
  assert.deepEqual(personalPanelTaskMutation(snapshot, { owner, id: 'task-1', revision: 'a'.repeat(64), action: 'complete' }), { op: 'task.complete', owner, id: 'task-1', revision: 'a'.repeat(64) });
  assert.throws(() => personalPanelTaskMutation(snapshot, { owner, id: 'task-1', revision: 'old', action: 'start' }));
  assert.throws(() => personalPanelTaskMutation(snapshot, { owner: { ...owner, spaceId: 'other' }, id: 'task-1', revision: 'a'.repeat(64), action: 'start' }));
  assert.throws(() => personalPanelTaskMutation({ ...snapshot, tasks: [{ ...snapshot.tasks[0], readOnly: true }] }, { owner, id: 'task-1', revision: 'a'.repeat(64), action: 'start' }));
});

test('adapter requests only the limited task operation', async () => {
  const calls = [];
  const adapter = new PersonalPanelTaskAdapter({ scriptPath: '/unused', run: async request => { calls.push(request); return native; } });
  assert.deepEqual(await adapter.list(), normalizePersonalPanelTaskList(native));
  assert.deepEqual(calls, [{ op: 'task.list', limit: 100, cursor: null }]);
});

test('HTTP mutation rejects stale revision and writes only after fresh native read', async () => {
  const calls = [];
  const adapter = { list: async () => { calls.push('list'); return normalizePersonalPanelTaskList(native); }, mutate: async command => { calls.push(command); return {}; } };
  const handler = createPersonalPanelTaskHttpHandler({ adapter, dashboardOrigin: 'http://127.0.0.1:47831' });
  const response = { statusCode: 0, headers: {}, writeHead(code, headers) { this.statusCode = code; this.headers = headers; }, end(value) { this.body = value; } };
  const request = { method: 'PATCH', headers: { origin: 'http://127.0.0.1:47831', 'content-type': 'application/json' }, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ owner, id: 'task-1', revision: 'old', action: 'complete' })); } };
  await handler(request, response, new URL('http://127.0.0.1:47831/api/personal-panel/tasks'));
  assert.equal(response.statusCode, 409);
  assert.deepEqual(calls, ['list']);
});

test('HTTP status action writes once and returns a fresh native readback', async () => {
  const calls = [];
  const adapter = { list: async () => { calls.push('list'); return normalizePersonalPanelTaskList(native); }, mutate: async command => { calls.push(command); return {}; } };
  const handler = createPersonalPanelTaskHttpHandler({ adapter, dashboardOrigin: 'http://127.0.0.1:47831' });
  const response = { writeHead(code) { this.statusCode = code; }, end(value) { this.body = JSON.parse(value); } };
  const request = { method: 'PATCH', headers: { origin: 'http://127.0.0.1:47831', 'content-type': 'application/json' }, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ owner, id: 'task-1', revision: 'a'.repeat(64), action: 'complete' })); } };
  await handler(request, response, new URL('http://127.0.0.1:47831/api/personal-panel/tasks'));
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.status, 'ok');
  assert.deepEqual(calls, ['list', { op: 'task.complete', owner, id: 'task-1', revision: 'a'.repeat(64) }, 'list']);
});

test('link action rejects a missing Codex conversation before native mutation', async () => {
  const calls = [];
  const adapter = {
    inspectLinks: async () => ({ version: 1, owner, schema: { ready: true } }),
    listLinks: async () => { calls.push('read'); return { taskId: 'task-1', revision: 'a'.repeat(64), readOnly: false, links: [] }; },
    mutate: async command => { calls.push(command); }
  };
  const handler = createPersonalPanelTaskHttpHandler({ adapter, localAdapter: { getTask: async () => null }, localDevice: { id: 'local:test' }, dashboardOrigin: 'http://127.0.0.1:47831' });
  const response = { writeHead(code) { this.statusCode = code; }, end(value) { this.body = JSON.parse(value); } };
  const request = { method: 'POST', headers: { origin: 'http://127.0.0.1:47831', 'content-type': 'application/json' }, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ action: 'link', owner, id: 'task-1', revision: 'a'.repeat(64), confirmed: true, deviceId: 'local:test', sessionId: 'thread-1' })); } };
  await handler(request, response, new URL('http://127.0.0.1:47831/api/personal-panel/links'));
  assert.equal(response.statusCode, 409);
  assert.deepEqual(calls, ['read']);
});

test('link action uses confirmed local identity, exact revision and native readback', async () => {
  const calls = [];
  let links = [];
  const adapter = {
    inspectLinks: async () => ({ version: 1, owner, schema: { ready: true } }),
    listLinks: async () => ({ taskId: 'task-1', revision: 'a'.repeat(64), readOnly: false, links }),
    mutate: async command => { calls.push(command); links = [{ source: 'codex', deviceId: 'local:test', sessionId: 'thread-1', linkedAt: 1 }]; }
  };
  const handler = createPersonalPanelTaskHttpHandler({ adapter, localAdapter: { getTask: async () => ({ id: 'thread-1', device: { id: 'local:test' } }) }, localDevice: { id: 'local:test' }, dashboardOrigin: 'http://127.0.0.1:47831' });
  const response = { writeHead(code) { this.statusCode = code; }, end(value) { this.body = JSON.parse(value); } };
  const request = { method: 'POST', headers: { origin: 'http://127.0.0.1:47831', 'content-type': 'application/json' }, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ action: 'link', owner, id: 'task-1', revision: 'a'.repeat(64), confirmed: true, deviceId: 'local:test', sessionId: 'thread-1' })); } };
  await handler(request, response, new URL('http://127.0.0.1:47831/api/personal-panel/links'));
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.task.links[0].sessionId, 'thread-1');
  assert.deepEqual(calls, [{ op: 'task.linkExecution', owner, id: 'task-1', revision: 'a'.repeat(64), confirmed: true, deviceId: 'local:test', sessionId: 'thread-1' }]);
});
