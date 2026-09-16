import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { createSidebarHttpHandler } from '../src/sidebar-http.mjs';
import { createDashboardServer } from '../src/http-server.mjs';
import { ACTION_HEADERS, signPeerAction } from '../src/peer-action-auth.mjs';
async function invoke(handler, pathname, headers, input) {
  const req = Readable.from([Buffer.from(JSON.stringify(input))]); req.method = 'POST'; req.headers = headers;
  const res = { writeHead(code) { this.code = code; }, end(body) { this.body = JSON.parse(body); } };
  await handler(req, res, new URL(pathname, 'http://127.0.0.1:47831')); return res;
}
test('browser sidebar mutations require the exact dashboard origin', async () => {
  let called = 0;
  const handler = createSidebarHttpHandler({ sidebarService: { apply: async () => { called++; return { applied: true }; } }, dashboardOrigin: 'http://127.0.0.1:47831' });
  for (const origin of ['http://localhost:47831', 'https://evil.test', undefined]) await assert.rejects(invoke(handler, '/api/sidebar/actions', { origin, 'content-type': 'application/json' }, {}));
  assert.equal(called, 0);
  const result = await invoke(handler, '/api/sidebar/actions', { origin: 'http://127.0.0.1:47831', 'content-type': 'application/json' }, {});
  assert.equal(result.body.applied, true); assert.equal(called, 1);
});
test('signed transport retries return one owner mutation receipt', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sidebar-auth-'));
  try {
    const key = crypto.randomBytes(32), keyPath = path.join(directory, 'key'); await fs.writeFile(keyPath, key.toString('base64'), { mode: 0o600 });
    let called = 0;
    const handler = createSidebarHttpHandler({ nativeSidebarAdapter: { apply: async () => { called++; await new Promise(resolve => setTimeout(resolve, 10)); return { applied: true, snapshot: { revision: 'read-back' } }; } }, nodeActionKeyPath: keyPath });
    const input = { action: 'section-create', name: 'X' }, body = Buffer.from(JSON.stringify(input)), pathname = '/api/node/actions/sidebar';
    const timestamp = String(Date.now()), nonce = crypto.randomUUID();
    const headers = { 'content-type': 'application/json', [ACTION_HEADERS.timestamp]: timestamp, [ACTION_HEADERS.nonce]: nonce,
      [ACTION_HEADERS.signature]: signPeerAction(key, { method: 'POST', path: pathname, timestamp, nonce, body }) };
    const [first, retry] = await Promise.all([invoke(handler, pathname, headers, input), invoke(handler, pathname, headers, input)]);
    assert.equal(called, 1); assert.deepEqual(first.body, retry.body); assert.equal(retry.body.snapshot.revision, 'read-back');
    await assert.rejects(invoke(handler, pathname, headers, { ...input, name: 'tampered' }), /认证失败/);
  } finally { await fs.rm(directory, { recursive: true }); }
});

test('dashboard composition exposes sidebar reads used by project and conversation boards', async t => {
  const config = {
    dashboardHost: '127.0.0.1', dashboardPort: 0, dashboardOrigin: 'http://127.0.0.1:0',
    cdpHost: '127.0.0.1', cdpPort: 9231, cdpOrigin: 'http://127.0.0.1:9231', profileDirectory: '/tmp/codex-sidebar-http-test'
  };
  const adapter = { async listTasks() { return { status: 'connected', tasks: [], projects: [] }; } };
  const sidebarService = { async read() { return { schemaVersion: 1, devices: [] }; } };
  const dashboard = createDashboardServer({ config, adapter, sidebarService });
  await dashboard.listen();
  t.after(() => dashboard.close());
  const response = await fetch(`http://127.0.0.1:${dashboard.server.address().port}/api/sidebar`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { schemaVersion: 1, devices: [] });
});
