import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createTaskCenterHttpHandler } from '../src/task-center-http.mjs';
import { ACTION_HEADERS, NonceReplayWindow, signPeerAction } from '../src/peer-action-auth.mjs';
import { sendJson } from '../src/http-utils.mjs';

async function fixture(t, overrides = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'task-center-http-'));
  const key = Buffer.alloc(32, 19), keyPath = path.join(directory, 'key');
  await fs.writeFile(keyPath, key.toString('base64'), { mode: 0o600 });
  const calls = { localRead: 0, aggregateRead: [], localWrite: [], routedWrite: [], images: [] };
  const now = 1_800_000_000_000;
  const service = { read: async options => { calls.aggregateRead.push(options); return { version: 1, localDeviceId: 'mac', devices: ['mac', 'win'] }; },
    apply: async input => { calls.routedWrite.push(input); return { applied: true, requestId: input.requestId }; }, ...overrides.service };
  const owner = { read: async () => { calls.localRead++; return { version: 1, device: { id: 'mac' }, items: [] }; },
    apply: async input => { calls.localWrite.push(input); return { applied: true, requestId: input.requestId }; }, ...overrides.owner };
  const images = { exportBundle: async input => { calls.images.push(input); return { version: 1, images: [] }; }, ...overrides.images };
  let handler;
  const server = http.createServer(async (request, response) => {
    try { if (!await handler(request, response, new URL(request.url, 'http://localhost'))) sendJson(response, 404, { message: 'not found' }); }
    catch (error) { sendJson(response, error.statusCode || 500, { message: error.message }); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  handler = createTaskCenterHttpHandler({ service, owner, images, dashboardOrigin: origin, nodeActionKeyPath: keyPath, now: () => now, replayWindow: new NonceReplayWindow({ now: () => now }) });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }); });
  let nonce = 0;
  const signed = (pathname, body, options = {}) => {
    const raw = typeof body === 'string' ? body : JSON.stringify(body), timestamp = String(options.timestamp ?? now);
    const token = options.nonce || `task_nonce_${String(++nonce).padStart(16, '0')}`;
    return { method: 'POST', body: raw, headers: { 'content-type': 'application/json', [ACTION_HEADERS.timestamp]: timestamp,
      [ACTION_HEADERS.nonce]: token, [ACTION_HEADERS.signature]: signPeerAction(key, { method: 'POST', path: pathname, timestamp, nonce: token, body: Buffer.from(raw) }) } };
  };
  return { origin, calls, signed };
}

test('task-center reads distinguish owner-only snapshot from aggregate snapshot and preserve refresh intent', async t => {
  const { origin, calls } = await fixture(t);
  const local = await fetch(origin + '/api/node/task-center').then(response => response.json());
  assert.equal(local.device.id, 'mac');
  assert.equal(calls.localRead, 1); assert.equal(calls.aggregateRead.length, 0);
  const all = await fetch(origin + '/api/task-center?refresh=1').then(response => response.json());
  assert.deepEqual(all.devices, ['mac', 'win']);
  assert.equal(calls.aggregateRead.length, 1); assert.equal(calls.aggregateRead[0].force, true);
  assert.equal(calls.aggregateRead[0].wait, true);
  const head = await fetch(origin + '/api/task-center', { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(await head.text(), '');
  assert.equal((await fetch(origin + '/api/task-center', { method: 'POST' })).status, 405);
  assert.equal((await fetch(origin + '/unrelated')).status, 404);
});

test('browser mutations require exact origin, JSON content type and a bounded valid body', async t => {
  const { origin, calls } = await fixture(t), pathname = '/api/task-center/actions', body = JSON.stringify({ requestId: 'one', ownerDeviceId: 'win' });
  for (const bad of [undefined, origin.replace('127.0.0.1', 'localhost'), origin + '/', 'https://example.com']) {
    const response = await fetch(origin + pathname, { method: 'POST', body, headers: { 'content-type': 'application/json', ...(bad ? { origin: bad } : {}) } });
    assert.equal(response.status, 403);
  }
  assert.equal(calls.routedWrite.length, 0);
  assert.equal((await fetch(origin + pathname, { method: 'POST', body, headers: { origin, 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await fetch(origin + pathname, { method: 'POST', body: '{', headers: { origin, 'content-type': 'application/json' } })).status, 400);
  assert.equal((await fetch(origin + pathname, { method: 'POST', body: 'x'.repeat(65537), headers: { origin, 'content-type': 'application/json' } })).status, 413);
  assert.equal((await fetch(origin + pathname, { method: 'POST', body, headers: { origin, 'content-type': 'application/json' } })).status, 200);
  assert.deepEqual(calls.routedWrite, [JSON.parse(body)]); assert.equal(calls.localWrite.length, 0);
});

test('signed owner mutations reject body/path/timestamp tampering and replay one actual write', async t => {
  const { origin, signed, calls } = await fixture(t), pathname = '/api/node/actions/task-center';
  const request = signed(pathname, { requestId: 'write-once', ownerDeviceId: 'mac' });
  assert.equal((await fetch(origin + pathname, { ...request, body: request.body + ' ' })).status, 401);
  assert.equal((await fetch(origin + '/api/node/actions/task-images', request)).status, 401);
  assert.equal((await fetch(origin + pathname, signed(pathname, {}, { timestamp: 1 }))).status, 401);
  const results = await Promise.all([fetch(origin + pathname, request), fetch(origin + pathname, request)]);
  assert.deepEqual(await Promise.all(results.map(response => response.json())), [
    { status: 'ok', applied: true, requestId: 'write-once' }, { status: 'ok', applied: true, requestId: 'write-once' }
  ]);
  assert.equal(calls.localWrite.length, 1); assert.equal(calls.routedWrite.length, 0);
  const changed = signed(pathname, { requestId: 'other' }, { nonce: request.headers[ACTION_HEADERS.nonce] });
  assert.equal((await fetch(origin + pathname, changed)).status, 409);
  assert.equal(calls.localWrite.length, 1);
});

test('owner rejections are durable receipts and do not expose unexpected internal error text', async t => {
  let calls = 0;
  const { origin, signed } = await fixture(t, { owner: { apply: async () => { calls++; throw Error('secret path'); } } });
  const pathname = '/api/node/actions/task-center', request = signed(pathname, { requestId: 'failure' });
  for (let index = 0; index < 2; index++) {
    const response = await fetch(origin + pathname, request);
    assert.equal(response.status, 409); assert.doesNotMatch(await response.text(), /secret path/);
  }
  assert.equal(calls, 1);
});

test('structured owner conflict codes remain visible in the signed receipt', async t => {
  const { origin, signed } = await fixture(t, { owner: { apply: async () => { throw Object.assign(Error('任务已变化'), { statusCode: 409, code: 'TASK_CONFLICT' }); } } });
  const pathname = '/api/node/actions/task-center', response = await fetch(origin + pathname, signed(pathname, { requestId: 'conflict' }));
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { status: 'error', code: 'TASK_CONFLICT', message: '任务已变化' });
});

test('read-only image exports require signatures, allow repeated reads and never invoke writes', async t => {
  const { origin, signed, calls } = await fixture(t), pathname = '/api/node/actions/task-images';
  const body = { scopeId: 'a'.repeat(64), id: 'one', expectedRevision: 'b'.repeat(64) };
  assert.equal((await fetch(origin + pathname, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })).status, 401);
  const request = signed(pathname, body);
  for (let index = 0; index < 2; index++) {
    const response = await fetch(origin + pathname, request);
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { status: 'ok', version: 1, images: [] });
  }
  assert.deepEqual(calls.images, [body, body]); assert.equal(calls.localWrite.length + calls.routedWrite.length, 0);
  assert.equal((await fetch(origin + pathname, signed(pathname, '{'))).status, 400);
});
