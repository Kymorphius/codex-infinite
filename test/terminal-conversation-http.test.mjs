import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createTerminalConversationHttpHandler } from '../src/terminal-conversation-http.mjs';
import { TerminalConversationService } from '../src/terminal-conversation-service.mjs';
import { TerminalService } from '../src/terminal-service.mjs';
import { sendJson } from '../src/http-utils.mjs';

async function fixture(t, available = true) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'managed-terminal-http-'));
  const terminalService = new TerminalService({ defaultCwd: directory, spawnProcess: async () => ({
    onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), kill: async () => {}, write() {}, resize() {},
  }) });
  const service = new TerminalConversationService({ terminalService, deviceId: 'owner', filePath: path.join(directory, 'registry.json') });
  let handler;
  const server = http.createServer(async (request, response) => {
    try {
      if (!await handler(request, response, new URL(request.url, 'http://localhost'))) sendJson(response, 404, {});
    } catch (error) { sendJson(response, error.statusCode || 500, { error: error.message }); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  handler = createTerminalConversationHttpHandler({ service: available ? service : null, dashboardOrigin: origin });
  t.after(async () => {
    await terminalService.dispose(); await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const request = (action, { method = 'POST', body = {}, headers = {} } = {}) => new Promise((resolve, reject) => {
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    const requestHeaders = { origin, 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), ...headers };
    for (const key of Object.keys(requestHeaders)) if (requestHeaders[key] === undefined) delete requestHeaders[key];
    const outgoing = http.request(`${origin}/api/terminal-conversations/${action}`, { method, headers: requestHeaders }, response => {
      let content = ''; response.setEncoding('utf8'); response.on('data', chunk => { content += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(content), headers: response.headers }));
    });
    outgoing.on('error', reject); outgoing.end(payload);
  });
  return { service, terminalService, request, origin, directory };
}
const actions = ['list', 'open', 'create', 'start', 'update', 'stop'];

test('every managed conversation endpoint requires exact Origin, Host and bounded POST JSON', async t => {
  const { request, origin, terminalService } = await fixture(t);
  for (const action of actions) {
    for (const headers of [{ origin: undefined }, { origin: 'null' }, { origin: 'https://attacker.example' },
      { origin: `${origin}/` }, { host: 'attacker.example' }, { host: '127.0.0.1:1' }]) {
      assert.equal((await request(action, { headers })).status, 403, action);
    }
    assert.equal((await request(action, { method: 'GET' })).status, 405);
    assert.equal((await request(action, { headers: { 'content-type': 'text/plain' } })).status, 415);
    for (const body of ['{', '[]', 'null', { command: 'ls' }]) assert.equal((await request(action, { body })).status, 400);
    assert.equal((await request(action, { body: { padding: 'a'.repeat(8192) } })).status, 413);
  }
  assert.equal(terminalService.list().sessions.length, 0);
});

test('managed HTTP exposes persistence, CAS and explicit runtime lifecycle without native thread IDs', async t => {
  const { request, directory } = await fixture(t);
  const createdResponse = await request('create', { body: { cwd: directory, kind: 'shell', title: '维护终端' } });
  assert.equal(createdResponse.status, 200); assert.equal(createdResponse.headers['cache-control'], 'no-store');
  const created = createdResponse.body.conversation;
  assert.equal(created.provider, 'terminal'); assert.notEqual(created.id, created.runtimeSessionId);
  assert.equal((await request('list')).body.conversations[0].id, created.id);
  assert.equal((await request('open', { body: { id: created.id } })).body.conversation.runtimeSessionId, created.runtimeSessionId);
  const update = { id: created.id, expectedRevision: 1, archived: true };
  assert.equal((await request('update', { body: update })).body.conversation.status, 'running');
  assert.equal((await request('update', { body: update })).status, 409);
  assert.equal((await request('stop', { body: { id: created.id } })).body.conversation.status, 'stopped');
  assert.equal((await request('open', { body: { id: created.id } })).body.conversation.status, 'stopped');
  assert.equal((await request('start', { body: { id: created.id } })).status, 409);
  assert.equal((await request('update', { body: { id: created.id, expectedRevision: 2, archived: false } })).status, 200);
  assert.equal((await request('start', { body: { id: created.id } })).body.conversation.status, 'running');
  assert.equal((await request('open', { body: { id: randomUUID() } })).status, 404);
  assert.equal((await request('create', { body: { cwd: directory, claudeSessionId: randomUUID() } })).status, 400);
  assert.equal((await request('open', { body: { id: created.runtimeSessionId } })).status, 404);
});

test('managed HTTP unavailable service returns 503 before accepting work', async t => {
  const { request } = await fixture(t, false);
  for (const action of actions) assert.equal((await request(action)).status, 503);
});
