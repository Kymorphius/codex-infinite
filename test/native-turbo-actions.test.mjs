import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { applyNativeTurboAction, buildNativeTurboActionSource, parseNativeTurboRequest, respondToNativeTurboBinding } from '../src/native-turbo-actions.mjs';
import { buildNativeTurboInjectionScript, buildNativeTurboSnapshotScript } from '../src/native-turbo-injection.mjs';

const request = (operation, change = { fast: false }) => JSON.stringify({ operation, requestId: 'turbo-action-test-123', change });

test('native settings strictly validate and dispatch distinct local save and all-device sync', async () => {
  const calls = [];
  const controller = Object.fromEntries(['save', 'sync', 'update'].map((operation) => [operation, async (change) => { calls.push({ operation, change }); return { operation }; }]));
  await applyNativeTurboAction(request('save'), controller);
  await applyNativeTurboAction(request('sync'), controller);
  await applyNativeTurboAction('{"enabled":true}', controller);
  assert.deepEqual(calls, [
    { operation: 'save', change: { fast: false } },
    { operation: 'sync', change: { fast: false } },
    { operation: 'update', change: { enabled: true } }
  ]);
  for (const value of [request('delete'), request('save', { operation: 'sync' }), request('sync', {}), request('save').replace('turbo-action-test-123', 'short'), request('save').replace('"change":', '"extra":true,"change":')]) {
    assert.equal(parseNativeTurboRequest(value), null);
  }
});

test('native binding delivers policy and per-device outcome to renderer and surfaces local failure', async () => {
  const snapshots = [], responses = [];
  const context = { window: { __codexControlConsoleSetTurboPolicy: (value) => snapshots.push(value), __codexControlConsoleTurboActionResult: (value) => responses.push(value) } };
  const connection = { evaluate: async (source) => vm.runInNewContext(source, context) };
  const nodes = [{ id: 'peer', status: 'error', message: '设备暂时不可达' }];
  await respondToNativeTurboBinding(request('sync'), connection, { sync: async () => ({ converged: false, nodes }), read: () => ({ fast: false }) });
  assert.equal(snapshots[0].fast, false);
  assert.equal(responses[0].requestId, 'turbo-action-test-123');
  assert.equal(responses[0].nodes[0].status, 'error');
  await respondToNativeTurboBinding(request('save'), connection, { save: async () => { throw new Error('/private/token-path'); } });
  assert.match(responses[1].error, /本机保存/);
  assert.doesNotMatch(responses[1].error, /private/);
});

test('pending request rejects duplicates and stale replies; snapshot updates cannot clear it', () => {
  const sent = [];
  const window = { binding: (value) => sent.push(JSON.parse(value)) };
  let timeout;
  const context = { window, Date, JSON, setTimeout(callback) { timeout = callback; return 1; }, clearTimeout() {} };
  vm.runInNewContext(`let pending = false; let requestSequence = 0; let renders = 0;
    function renderTurboSettingsResult() { renders++; } function installButton() {}
    ${buildNativeTurboActionSource('binding')}
    globalThis.send = turboSend; globalThis.getState = () => ({ pending, ...state });`, context);
  assert.equal(context.send({ fast: false }, 'save'), true);
  assert.equal(context.send({ fast: true }, 'sync'), false);
  assert.equal(sent.length, 1);
  assert.equal(window.__codexControlConsoleTurboActionResult({ requestId: 'stale' }), false);
  assert.equal(context.getState().pending, true);
  assert.equal(window.__codexControlConsoleTurboActionResult({ requestId: sent[0].requestId, operation: 'save', nodes: [] }), true);
  assert.equal(context.getState().pending, false);
  assert.equal(context.send({ fast: true }, 'sync'), true);
  timeout();
  assert.equal(context.getState().pending, false);
  assert.match(context.getState().turboActionResult.error, /等待结果超时/);

  const runtimeContext = {
    window: { addEventListener() {}, electronBridge: {} },
    document: { querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => null }, setInterval: () => 1, clearInterval() {}, setTimeout, clearTimeout
  };
  const source = buildNativeTurboInjectionScript().replace('  install();\n  installTimer =', "  state.turboActionPending = { requestId: 'pending-test-123', operation: 'save' }; pending = true; globalThis.pendingState = () => pending;\n  install();\n  installTimer =");
  vm.runInNewContext(source, runtimeContext);
  vm.runInNewContext(buildNativeTurboSnapshotScript({ enabled: true }), runtimeContext);
  assert.equal(runtimeContext.pendingState(), true);
});
