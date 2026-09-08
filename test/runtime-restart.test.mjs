import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { RuntimeRestartService, serviceManagerCommands, assertDedicatedProfile, inspectRestartTarget } from '../src/runtime-restart.mjs';
import { createRuntimeRestartHttpHandler } from '../src/runtime-restart-http.mjs';
import { restartRuntime } from '../scripts/restart-runtime.mjs';
import { installRestartButton } from '../public/features/runtime/index.js';
const config = { profileDirectory: '/dedicated' }, instance = '01a04cd6-8d30-78f1-b2a7-f760d148f744';
test('Windows restart inspection passes its command adapter through package and process discovery', async () => {
  const executable = 'C:\\Program Files\\WindowsApps\\OpenAI.Codex_1\\app\\ChatGPT.exe';
  const calls = [];
  const result = await inspectRestartTarget({ cdpPort: 9231 }, { platform: 'win32', execute: async (_file, args) => {
    calls.push(args.at(-1));
    if (args.at(-1).includes('Get-AppxPackage')) return { stdout: 'C:\\Program Files\\WindowsApps\\OpenAI.Codex_1' };
    return { stdout: JSON.stringify({ ProcessId: 12, ExecutablePath: executable, CommandLine: `"${executable}" --user-data-dir="C:\\Dedicated" --remote-debugging-port=9231` }) };
  } });
  assert.equal(result.pid, 12); assert.equal(result.profileDirectory, 'C:\\Dedicated');
  assert.equal(calls.length, 2); assert.match(calls[0], /Get-AppxPackage/); assert.match(calls[1], /Win32_Process/);
});
test('restart coalesces requests and rejects foreign profile before launching helper', async () => {
  const calls = [];
  const service = new RuntimeRestartService({ config, platform: 'darwin', uid: 501, exec: async () => calls.push('check'), inspect: async () => ({ pid: 12, profileDirectory: '/dedicated' }), launch: async () => calls.push('launch'), prepare: async () => calls.push('prepare') });
  await Promise.all([service.request(), service.request()]); await service.request();
  assert.deepEqual(calls, ['check', 'launch', 'prepare']); assert.equal(service.status().restarting, true);
  const wrong = new RuntimeRestartService({ config, platform: 'darwin', uid: 501, exec: async () => {}, inspect: async () => ({ pid: 12, profileDirectory: '/primary' }), launch: async () => assert.fail('must not launch') });
  await assert.rejects(wrong.request(), /身份/);
  assert.throws(() => serviceManagerCommands('linux', 1));
  assert.doesNotThrow(() => assertDedicatedProfile({ pid: 12, profileDirectory: 'c:\\Own' }, { profileDirectory: 'C:\\Own' }, 'win32'));
});
test('worker checks identity then closes only dedicated PID before restarting fixed manager target', async () => {
  const calls = []; let inspectCount = 0;
  await restartRuntime({ config, serverPid: 20, oldInstance: instance, platform: 'darwin', uid: 501,
    execute: async (cmd, args) => calls.push([cmd, args]), wait: async () => {},
    inspect: async () => ++inspectCount === 1 ? { pid: 12, profileDirectory: '/dedicated' } : null,
    kill: (pid, signal) => calls.push([pid, signal]), recover: async () => calls.push('recovered') });
  assert.deepEqual(calls, [['/bin/launchctl', ['print', 'gui/501/dev.codex-control-console']], [12, 'SIGTERM'], ['/bin/launchctl', ['kickstart', '-k', 'gui/501/dev.codex-control-console']], 'recovered']);
  calls.length = 0;
  await restartRuntime({ config, serverPid: 20, oldInstance: instance, platform: 'win32', execute: async (cmd, args) => calls.push([cmd, args]), wait: async () => {}, inspect: async () => ({ pid: 12, profileDirectory: '/dedicated' }), recover: async () => {} });
  assert.deepEqual(calls[1], ['taskkill.exe', ['/PID', '12', '/T', '/F']]);
  assert.deepEqual(calls[2], ['taskkill.exe', ['/PID', '20', '/F']]); // helper must survive; no /T on backend
  assert.match(calls[3][1].at(-1), /Start-ScheduledTask/);
});
test('restart endpoint requires exact Origin, explicit confirmation and no arbitrary target fields', async () => {
  let requests = 0;
  const handler = createRuntimeRestartHttpHandler({ dashboardOrigin: 'http://127.0.0.1:47831', service: { request: async () => { requests++; return { instanceId: instance }; } } });
  const invoke = async (body, origin) => {
    const req = Readable.from([Buffer.from(JSON.stringify(body))]); req.method = 'POST'; req.headers = { origin, 'content-type': 'application/json' };
    const response = { writeHead(code) { this.code = code; }, end() {} };
    await handler(req, response, new URL('http://localhost/api/runtime/restart')); return response.code;
  };
  await assert.rejects(invoke({ confirm: true }, 'https://evil.example'), { statusCode: 403 });
  await assert.rejects(invoke({ confirm: true, pid: 12 }, 'http://127.0.0.1:47831'), { statusCode: 400 });
  assert.equal(requests, 0);
  assert.equal(await invoke({ confirm: true }, 'http://127.0.0.1:47831'), 202); assert.equal(requests, 1);
});
test('restart UI cancellation is inert and recovery requires a new instance', async () => {
  let click, requests = 0, reloaded = 0;
  const button = { addEventListener(_name, fn) { click = fn; } };
  installRestartButton({ button, showToast() {}, confirmImpl: () => false, fetchImpl: () => assert.fail() }); await click();
  installRestartButton({ button, showToast() {}, confirmImpl: () => true, sleep: async () => {}, reload: () => reloaded++, fetchImpl: async () => ({ ok: true, json: async () => ({ instanceId: ++requests < 3 ? instance : 'new-instance' }) }) });
  await click(); assert.equal(reloaded, 1); assert.equal(requests, 3); assert.equal(button.textContent, '重启'); assert.equal(button.disabled, false);
});

test('embedded confirmation uses a page dialog and defaults to cancel', async () => {
  const { confirmRestart } = await import('../public/features/runtime/index.js');
  const nodes = [];
  const documentImpl = { body: { append() {} }, createElement(tag) {
    const node = { tag, style: {}, listeners: {}, append() {}, addEventListener(type, listener) { this.listeners[type] = listener; }, showModal() { this.shown = true; }, focus() { this.focused = true; }, close() {}, remove() { this.removed = true; } }; nodes.push(node); return node;
  } };
  const result = confirmRestart('重启？', documentImpl);
  assert.equal(nodes.find(n => n.tag === 'dialog').shown, true);
  const cancel = nodes.find(n => n.textContent === '取消'); assert.equal(cancel.focused, true);
  cancel.listeners.click(); assert.equal(await result, false);
  assert.equal(nodes.find(n => n.tag === 'dialog').removed, true);
});
