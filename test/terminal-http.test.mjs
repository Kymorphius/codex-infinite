import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createTerminalHttpHandler } from '../src/terminal-http.mjs';
import { TerminalService } from '../src/terminal-service.mjs';
import { sendJson } from '../src/http-utils.mjs';

async function fixture(t, available = true) {
  const spawned = [], killed = [];
  const service = new TerminalService({ defaultCwd: '/terminal-fixture', validateCwd: async () => {},
    spawnProcess: async options => {
      spawned.push(options);
      return { onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }),
        kill: async () => killed.push(options), write() {}, resize() {} };
    } });
  let handler;
  const server = http.createServer(async (request, response) => {
    try {
      if (!await handler(request, response, new URL(request.url, 'http://localhost'))) sendJson(response, 404, {});
    } catch (error) { sendJson(response, error.statusCode || 500, { error: error.message }); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  handler = createTerminalHttpHandler({ service: available ? service : null, dashboardOrigin: origin });
  t.after(async () => { await service.dispose(); await new Promise(resolve => server.close(resolve)); });
  const request = (endpoint, { method = 'POST', body = '{}', headers = {} } = {}) => new Promise((resolve, reject) => {
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    const requestHeaders = { origin, 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), ...headers };
    for (const key of Object.keys(requestHeaders)) if (requestHeaders[key] === undefined) delete requestHeaders[key];
    const outgoing = http.request(`${origin}/api/terminal/${endpoint}`, { method,
      headers: requestHeaders }, incoming => {
      let data = ''; incoming.setEncoding('utf8'); incoming.on('data', chunk => { data += chunk; });
      incoming.on('end', () => resolve({ status: incoming.statusCode, body: data ? JSON.parse(data) : null, headers: incoming.headers }));
    });
    outgoing.on('error', reject); outgoing.end(payload);
  });
  return { request, origin, service, spawned, killed };
}

test('terminal HTTP enforces exact Origin and Host on list, create and close', async t => {
  const { request, origin, service, spawned } = await fixture(t);
  const session = await service.create({});
  for (const endpoint of ['list', 'create', 'close']) {
    const body = endpoint === 'close' ? { id: session.id } : {};
    for (const headers of [
      { origin: undefined }, { origin: '' }, { origin: 'null' }, { origin: 'https://attacker.example' },
      { origin: 'http://127.0.0.1:1' },
      { origin: `${origin}/` }, { origin: origin.replace('127.0.0.1', 'localhost') },
      { host: 'attacker.example' }, { host: '127.0.0.1:1' },
    ]) assert.equal((await request(endpoint, { body, headers })).status, 403, `${endpoint}: ${JSON.stringify(headers)}`);
  }
  assert.equal(spawned.length, 1);
  assert.equal(service.list().sessions.length, 1);
});

test('terminal HTTP accepts only bounded POST JSON with endpoint-specific fields', async t => {
  const { request, spawned } = await fixture(t);
  for (const endpoint of ['list', 'create', 'close']) {
    assert.equal((await request(endpoint, { method: 'GET' })).status, 405);
    assert.equal((await request(endpoint, { method: 'PUT' })).status, 405);
    assert.equal((await request(endpoint, { headers: { 'content-type': 'text/plain' } })).status, 415);
    assert.equal((await request(endpoint, { body: '{' })).status, 400);
    assert.equal((await request(endpoint, { body: '[]' })).status, 400);
    assert.equal((await request(endpoint, { body: 'null' })).status, 400);
    assert.equal((await request(endpoint, { body: { command: 'arbitrary command' } })).status, 400);
    assert.equal((await request(endpoint, { body: JSON.stringify({ padding: 'x'.repeat(8192) }) })).status, 413);
  }
  for (const body of [{ kind: 'custom' }, { cols: 0 }, { rows: 301 }, { cwd: 'bad\npath' }, { env: {} }]) {
    assert.equal((await request('create', { body })).status, 400);
  }
  assert.equal((await request('close', { body: {} })).status, 400);
  assert.equal((await request('close', { body: { id: '../outside' } })).status, 400);
  assert.equal((await request('close', { body: { id: 'absent' } })).status, 404);
  assert.equal(spawned.length, 0);
});

test('terminal HTTP creates, lists and closes a local session with no-store responses', async t => {
  const { request, spawned, killed } = await fixture(t);
  const before = await request('list');
  assert.equal(before.status, 200);
  assert.deepEqual(before.body, { sessions: [], defaultCwd: '/terminal-fixture' });
  const created = await request('create', { body: { kind: 'claude', cols: 120, rows: 35 } });
  assert.equal(created.status, 200);
  assert.equal(created.headers['cache-control'], 'no-store');
  assert.equal(created.body.session.kind, 'claude');
  assert.equal(created.body.session.status, 'running');
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].cwd, '/terminal-fixture');
  assert.equal(spawned[0].cols, 120);
  assert.deepEqual((await request('list')).body.sessions, [created.body.session]);
  const closed = await request('close', { body: { id: created.body.session.id } });
  assert.equal(closed.status, 200);
  assert.deepEqual(closed.body, { ok: true });
  assert.equal(killed.length, 1);
  assert.deepEqual((await request('list')).body.sessions, []);
});

test('terminal HTTP reports unavailable service without accepting terminal work', async t => {
  const { request, spawned } = await fixture(t, false);
  for (const endpoint of ['list', 'create', 'close']) assert.equal((await request(endpoint)).status, 503);
  assert.equal(spawned.length, 0);
});
