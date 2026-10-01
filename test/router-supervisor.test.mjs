import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { RouterSupervisor } from '../src/router-supervisor.mjs';
import { createRouterSupervisionHttpHandler } from '../src/router-supervision-http.mjs';
import { deriveRuntimeDiagnostics } from '../src/runtime-diagnostics.mjs';

function fakeAdapter(initial) {
  const state = { ...initial, calls: [] };
  return {
    state,
    async inspectService() { return { supported: true, label: 'io.github.codex-router', installed: true, enabled: state.enabled ?? true, loaded: state.loaded, state: state.loaded ? 'running' : 'not loaded', pid: state.loaded ? 7 : null }; },
    async probeHealth() { return { reachable: state.reachable ?? true, ok: state.reachable ?? true, version: '0.6.0', degraded: [], activeCount: 0 }; },
    async bootstrap() { state.calls.push('bootstrap'); if (state.failBootstrap) throw Object.assign(new Error('x'), { stderr: 'Bootstrap failed: 5' }); state.loaded = true; },
    async kickstart() { state.calls.push('kickstart'); state.reachable = true; }
  };
}

test('supervisor bootstraps a stopped agent only after two observations and then throttles', async () => {
  let now = 1_000_000;
  const adapter = fakeAdapter({ loaded: false, failBootstrap: true });
  const supervisor = new RouterSupervisor({ adapter, now: () => now, log() {} });
  await supervisor.tick();
  assert.deepEqual(adapter.state.calls, []);
  now += 15_000; await supervisor.tick();
  assert.deepEqual(adapter.state.calls, ['bootstrap']);
  const snapshot = await supervisor.read();
  assert.equal(snapshot.status, 'stopped'); assert.equal(snapshot.lastRepair.ok, false); assert.match(snapshot.lastRepair.message, /Bootstrap failed/);
  for (let index = 0; index < 4; index += 1) { now += 15_000; await supervisor.tick(); }
  assert.deepEqual(adapter.state.calls, ['bootstrap']);
  adapter.state.failBootstrap = false; now += 5 * 60_000; await supervisor.tick();
  assert.deepEqual(adapter.state.calls, ['bootstrap', 'bootstrap']);
  assert.equal((await supervisor.check()).status, 'ready');
});

test('disabled agents and auto-repair opt-out are never started automatically', async () => {
  let now = 0;
  const disabled = fakeAdapter({ loaded: false, enabled: false });
  const first = new RouterSupervisor({ adapter: disabled, now: () => (now += 20_000), log() {} });
  for (let index = 0; index < 3; index += 1) await first.tick();
  await assert.rejects(first.repair(), (error) => error.statusCode === 409);
  const optedOut = fakeAdapter({ loaded: false });
  const second = new RouterSupervisor({ adapter: optedOut, autoRepair: false, now: () => (now += 20_000), log() {} });
  for (let index = 0; index < 3; index += 1) await second.tick();
  assert.deepEqual([...disabled.state.calls, ...optedOut.state.calls], []);
  assert.equal((await second.repair()).status, 'ready');
  assert.deepEqual(optedOut.state.calls, ['bootstrap']);
});

test('manual repair restarts an unresponsive loaded router and feeds diagnostics', async () => {
  const adapter = fakeAdapter({ loaded: true, reachable: false });
  const supervisor = new RouterSupervisor({ adapter, log() {} });
  await supervisor.check();
  assert.equal(supervisor.diagnostics().status, 'degraded');
  const result = await supervisor.repair();
  assert.deepEqual(adapter.state.calls, ['kickstart']); assert.equal(result.status, 'ready'); assert.equal(result.lastRepair.trigger, 'manual');
  const diagnostics = deriveRuntimeDiagnostics({ router: supervisor.diagnostics() });
  assert.equal(diagnostics.checks.find((check) => check.name === 'codex-router').status, 'ready');
});

function request(method, { origin, contentType = 'application/json', body = '' } = {}) {
  const stream = Readable.from(body ? [Buffer.from(body)] : []);
  return Object.assign(stream, { method, headers: { ...(origin ? { origin } : {}), 'content-type': contentType } });
}
function response() {
  return { statusCode: null, body: null, writeHead(code) { this.statusCode = code; }, end(payload) { this.body = JSON.parse(payload); } };
}

test('router HTTP requires exact origin, JSON and explicit confirmation to repair', async () => {
  const origin = 'http://127.0.0.1:47831';
  const calls = [];
  const supervisor = { read: async () => ({ status: 'ready' }), repair: async () => { calls.push('repair'); return { status: 'ready' }; } };
  const handle = createRouterSupervisionHttpHandler({ supervisor, dashboardOrigin: origin });
  assert.equal(await handle(request('GET'), response(), new URL('http://x/api/other')), false);
  const status = response();
  await handle(request('GET'), status, new URL('http://x/api/router/status'));
  assert.deepEqual([status.statusCode, status.body], [200, { status: 'ready' }]);
  const repairUrl = new URL('http://x/api/router/repair');
  await assert.rejects(handle(request('POST', { origin: 'http://evil', body: '{"confirm":true}' }), response(), repairUrl), (error) => error.statusCode === 403);
  await assert.rejects(handle(request('POST', { origin, contentType: 'text/plain', body: '{"confirm":true}' }), response(), repairUrl), (error) => error.statusCode === 415);
  await assert.rejects(handle(request('POST', { origin, body: '{"confirm":true,"action":"x"}' }), response(), repairUrl), (error) => error.statusCode === 400);
  assert.deepEqual(calls, []);
  const accepted = response();
  await handle(request('POST', { origin, body: '{"confirm":true}' }), accepted, repairUrl);
  assert.equal(accepted.statusCode, 202); assert.deepEqual(calls, ['repair']);
});
