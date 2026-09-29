import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TerminalService } from '../src/terminal-service.mjs';
import { TerminalConversationService } from '../src/terminal-conversation-service.mjs';

const threadId = '01a0dbff-aa1c-7592-9d9b-b2bbd5a3184e', sid = '11111111-1111-4111-8111-111111111111';

async function fixture(t, { holders = [] } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'terminal-mirror-'));
  const projects = path.join(directory, '.claude', 'projects', 'p'); await fs.mkdir(projects, { recursive: true });
  await fs.writeFile(path.join(projects, `${sid}.jsonl`), JSON.stringify({ type: 'assistant', sessionId: sid, uuid: 'a', message: { content: [{ type: 'text', text: 'hello from Claude' }] } }) + '\n');
  const terminalService = new TerminalService({ userHome: directory, defaultCwd: directory,
    spawnProcess: async input => ({ input, onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), kill: async () => {}, write() {}, resize() {} }) });
  const occupancy = async () => holders[0] || null; occupancy.all = async () => holders;
  const sent = [];
  const service = new TerminalConversationService({ terminalService, filePath: path.join(directory, 'registry.json'), deviceId: 'd',
    companions: { list: async () => [{ threadId, sessionId: sid, cwd: directory }] },
    claudeTranscripts: { summary: async () => ({ title: '', ids: [sid] }), search: async () => null }, claudeOccupancy: occupancy,
    transcriptExists: async () => true, mirrorTurns: { state: () => null, send: input => { sent.push(input); return { state: 'waiting' }; } } });
  t.after(async () => { await terminalService.dispose(); await fs.rm(directory, { recursive: true, force: true }); });
  await service.list();
  return { service, sent, directory };
}

test('a companion session is mirrored from its transcript and sends one-shot turns', async t => {
  const { service, sent, directory } = await fixture(t, { holders: [{ pid: 3, sessionId: sid, codexTurn: true }] });
  const view = await service.mirror({ id: sid, cursor: null });
  assert.deepEqual(view.entries.map(entry => [entry.role, entry.text]), [['claude', 'hello from Claude']]);
  assert.equal(view.occupiedBy, 'codex'); assert.equal(view.cursor.sessionId, sid);
  assert.deepEqual((await service.mirror({ id: sid, cursor: view.cursor })).entries, []);
  assert.deepEqual(await service.mirrorSend({ id: sid, text: '继续' }), { turn: { state: 'waiting' } });
  assert.deepEqual(sent, [{ id: sid, ids: [sid], target: sid, cwd: directory, text: '继续' }]);
});

test('only companions are mirrored, and not while an interactive Claude runs here', async t => {
  const { service, directory } = await fixture(t);
  const plain = await service.create({ cwd: directory, kind: 'shell' });
  await assert.rejects(service.mirror({ id: plain.id, cursor: null }), error => error.statusCode === 400);
  await service.start({ id: sid });
  await assert.rejects(service.mirrorSend({ id: sid, text: 'x' }), error => error.statusCode === 409 && /交互模式/.test(error.message));
});

test('mirror routes validate input, keep the exact-origin check and answer a send with 202', async t => {
  const http = await import('node:http'), { once } = await import('node:events');
  const { createTerminalConversationHttpHandler } = await import('../src/terminal-conversation-http.mjs');
  const { sendJson } = await import('../src/http-utils.mjs');
  const calls = [], service = { mirror: async input => (calls.push(['mirror', input]), { entries: [] }), mirrorSend: async input => (calls.push(['send', input]), { turn: { state: 'waiting' } }) };
  let handler;
  const server = http.createServer(async (request, response) => {
    try { if (!await handler(request, response, new URL(request.url, 'http://localhost'))) sendJson(response, 404, {}); }
    catch (error) { sendJson(response, error.statusCode || 500, { error: error.message }); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  handler = createTerminalConversationHttpHandler({ service, dashboardOrigin: origin });
  const post = async (action, body, from = origin) => {
    const response = await fetch(`${origin}/api/terminal-conversations/${action}`, { method: 'POST', headers: { origin: from, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return response.status;
  };
  assert.equal(await post('mirror', { id: sid, cursor: { sessionId: sid, offset: 10 } }), 200);
  assert.equal(await post('mirror', { id: sid, cursor: { sessionId: sid, offset: -1 } }), 400);
  assert.equal(await post('mirror-send', { id: sid, text: '长消息'.repeat(3000) }), 202);
  assert.equal(await post('mirror-send', { id: sid, text: '' }), 400);
  assert.equal(await post('mirror-send', { id: sid, text: 'x' }, 'http://evil.example'), 403);
  assert.deepEqual(calls.map(([name]) => name), ['mirror', 'send']);
});
