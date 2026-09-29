import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createDiscussionHttpHandler } from '../src/discussion-http.mjs';
import { sendJson } from '../src/http-utils.mjs';

const ID = '11111111-1111-4111-8111-111111111111';

async function fixture(t, service) {
  let handler;
  const server = http.createServer(async (request, response) => {
    try { if (!await handler(request, response, new URL(request.url, 'http://localhost'))) sendJson(response, 404, {}); }
    catch (error) { sendJson(response, error.statusCode || 500, { error: error.message }); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  handler = createDiscussionHttpHandler({ service, dashboardOrigin: origin });
  t.after(() => new Promise(resolve => server.close(resolve)));
  return (action, { method = 'POST', body = {}, headers = {} } = {}) => new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const outgoing = http.request(`${origin}/api/discussions/${action}`, { method,
      headers: { origin, 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), ...headers } }, response => {
      let content = ''; response.setEncoding('utf8'); response.on('data', chunk => { content += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(content) }));
    });
    outgoing.on('error', reject); outgoing.end(payload);
  });
}

test('forward validates the body, then calls the service with normalized input', async t => {
  const calls = [];
  const request = await fixture(t, { forward: async input => { calls.push(input); return { ok: true }; } });
  assert.equal((await request('forward', { body: { id: ID.toUpperCase(), from: 'claude', comment: ' 好 ' } })).status, 200);
  assert.deepEqual(calls, [{ id: ID, from: 'claude', comment: '好' }]);
  assert.equal((await request('forward', { body: { id: ID, from: 'claude', extra: true } })).status, 400);
  assert.equal((await request('forward', { body: { id: ID, from: 'gpt', comment: 'x'.repeat(4001) } })).status, 413);
  assert.equal(calls.length, 1);
});

test('only exact-origin JSON POSTs reach the service; unknown actions fall through', async t => {
  const request = await fixture(t, { list: async () => ({ discussions: [] }) });
  assert.equal((await request('list', { method: 'GET' })).status, 405);
  assert.notEqual((await request('list', { headers: { origin: 'http://evil.example' } })).status, 200);
  assert.notEqual((await request('list', { headers: { 'content-type': 'text/plain' } })).status, 200);
  assert.equal((await request('nope')).status, 404);
  assert.equal((await request('list')).status, 200);
});

test('a missing service is reported as unavailable', async t => {
  const request = await fixture(t, null);
  assert.equal((await request('list')).status, 503);
});
