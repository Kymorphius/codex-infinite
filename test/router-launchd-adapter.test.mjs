import test from 'node:test';
import assert from 'node:assert/strict';
import { RouterLaunchdAdapter, parseLaunchctlPrint, parseDisabledOverride, normalizeRouterHealth, routerHealthUrl } from '../src/router-launchd-adapter.mjs';

const PRINT = 'gui/501/io.github.codex-router = {\n\tactive count = 1\n\tpath = /x.plist\n\tstate = running\n\tendpoints = {\n\t\t"a" = {\n\t\t\tstate = active\n\t\t}\n\t}\n\tpid = 59597\n}\n';
const options = (overrides = {}) => ({ label: 'io.github.codex-router', plistPath: '/agents/io.github.codex-router.plist', routerOrigin: 'http://127.0.0.1:4202', platform: 'darwin', uid: 501, exists: async () => true, ...overrides });

test('launchctl output parsing reads only top-level state and pid', () => {
  assert.deepEqual(parseLaunchctlPrint(PRINT), { state: 'running', pid: 59597 });
  assert.deepEqual(parseLaunchctlPrint('x = {\n\tpath = /x\n}'), { state: 'loaded', pid: null });
  const disabled = '\tdisabled services = {\n\t\t"io.github.codex-router" => disabled\n\t\t"io.github.codex-router.tray" => enabled\n\t}';
  assert.equal(parseDisabledOverride(disabled, 'io.github.codex-router'), false);
  assert.equal(parseDisabledOverride(disabled, 'io.github.codex-router.tray'), true);
  assert.equal(parseDisabledOverride('', 'io.github.codex-router'), true);
});

test('service inspection uses fixed launchctl argv and reports an unloaded agent', async () => {
  const calls = [];
  const adapter = new RouterLaunchdAdapter(options({ exec: async (file, args) => {
    calls.push([file, ...args]);
    if (args[0] === 'print') throw Object.assign(new Error('not found'), { code: 113 });
    return { stdout: '' };
  } }));
  assert.deepEqual(await adapter.inspectService(), { supported: true, label: 'io.github.codex-router', installed: true, enabled: true, loaded: false, state: 'not loaded', pid: null });
  assert.deepEqual(calls, [['/bin/launchctl', 'print-disabled', 'gui/501'], ['/bin/launchctl', 'print', 'gui/501/io.github.codex-router']]);
  calls.length = 0;
  await adapter.bootstrap(); await adapter.kickstart();
  assert.deepEqual(calls, [['/bin/launchctl', 'bootstrap', 'gui/501', '/agents/io.github.codex-router.plist'], ['/bin/launchctl', 'kickstart', '-k', 'gui/501/io.github.codex-router']]);
});

test('unsupported platforms and unsafe labels never reach launchctl', async () => {
  const adapter = new RouterLaunchdAdapter(options({ platform: 'win32', exec: () => assert.fail('no exec') }));
  assert.deepEqual(await adapter.inspectService(), { supported: false, label: 'io.github.codex-router' });
  await assert.rejects(adapter.bootstrap(), /不支持/);
  assert.throws(() => new RouterLaunchdAdapter(options({ label: 'x; rm -rf /' })), /标签/);
});

test('health probe is loopback-only and drops session content', async () => {
  assert.throws(() => routerHealthUrl('http://example.com:4202'), /127\.0\.0\.1/);
  const body = { ok: true, version: '0.6.0', degraded: [], activity: { state: 'busy', activeCount: 2, sessionName: 'private title', model: 'm' } };
  assert.deepEqual(normalizeRouterHealth(body), { reachable: true, ok: true, version: '0.6.0', degraded: [], activeCount: 2 });
  let requested;
  const adapter = new RouterLaunchdAdapter(options({ fetchImpl: async (url) => { requested = url; return { ok: true, json: async () => body }; } }));
  const result = await adapter.probeHealth();
  assert.equal(requested, 'http://127.0.0.1:4202/health'); assert.equal(result.ok, true); assert.equal(JSON.stringify(result).includes('private'), false);
  const down = new RouterLaunchdAdapter(options({ fetchImpl: async () => { throw new Error('ECONNREFUSED'); } }));
  assert.deepEqual(await down.probeHealth(), { reachable: false, ok: false, version: null, degraded: [], activeCount: null });
});
