import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createClaudePreviewSelection } from '../src/claude-preview-selection.mjs';
import { buildNativeClaudePreviewInjectionScript, buildNativeClaudePanelStyleScript } from '../src/native-claude-preview.mjs';

const id = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
function harness(overrides = {}) {
  const values = new Map(), initial = { model: 'gpt-6-sol', reasoningEffort: 'medium' };
  let current = { ...initial };
  const storage = { getItem: k => values.get(k), setItem: (k, v) => values.set(k, v) };
  const options = { storage, read: async () => current, apply: async (_id, next) => { current = next; }, ...overrides };
  return { controller: createClaudePreviewSelection(options), options, initial, current: () => current };
}
test('enable, change effort, reload and restore preserve only original model and effort', async () => {
  const h = harness(), c = h.controller;
  await c.set(id, 'medium');
  assert.equal(h.current().model, 'claude-subscription/opus');
  assert.equal(c.blocks(id), true); assert.equal(c.blocks(other), false);
  await c.set(id, 'high');
  const reloaded = createClaudePreviewSelection(h.options);
  assert.equal(reloaded.selected(id).effort, 'high');
  await reloaded.set(id, null);
  assert.deepEqual(h.current(), h.initial);
  assert.equal(reloaded.blocks(id), false);
});
test('invalid selection is rejected before native setting calls', async () => {
  let reads = 0;
  const { controller } = harness({ read: async () => { reads++; } });
  for (const [thread, effort] of [[id, 'ultra'], ['remote', 'medium']]) await assert.rejects(controller.set(thread, effort));
  assert.equal(reads, 0);
});
test('native tools mode survives reload, switches off, and restores original GPT settings', async () => {
  const h = harness();
  await h.controller.set(id, 'high', true);
  assert.equal(h.current().model, 'claude-subscription/opus-native');
  const reloaded = createClaudePreviewSelection(h.options);
  assert.equal(reloaded.selected(id).nativeTools, true);
  assert.equal(reloaded.selected(other), null);
  await reloaded.set(id, 'medium', false);
  assert.equal(h.current().model, 'claude-subscription/opus');
  await reloaded.set(id, null);
  assert.deepEqual(h.current(), h.initial);
});
test('in-flight selection blocks only its conversation; concurrent toggles refused', async () => {
  let release;
  const { controller } = harness({ read: async () => new Promise(resolve => { release = resolve; }) });
  const first = controller.set(id, 'low');
  assert.equal(controller.blocks(id), true); assert.equal(controller.blocks(other), false);
  await assert.rejects(controller.set(id, 'high'), /正在修改/);
  release({}); await assert.rejects(first, /回读/);
  assert.equal(controller.blocks(id), false);
});
test('unconfirmed change rolls back, never reports selected', async () => {
  const calls = [], original = { model: 'gpt-6-luna', reasoningEffort: 'low' };
  const { controller } = harness({ read: async () => original, apply: async (_id, next) => { calls.push(next); } });
  await assert.rejects(controller.set(id, 'high'), /回读不一致/);
  assert.deepEqual(calls.at(-1), original);
  assert.equal(controller.selected(id), null);
});
test('failed rollback explicitly reports uncertainty', async () => {
  let applies = 0;
  const { controller } = harness({ apply: async () => { if (++applies === 2) throw new Error('offline'); } });
  await assert.rejects(controller.set(id, 'medium'), /恢复失败/);
});
test('renderer installs idempotently without polling or sending any request', () => {
  const subscribers = new Set(), window = { __codexControlConsoleMutationSubscribers: subscribers, addEventListener() {} };
  const context = { window, localStorage: { getItem: () => null }, document: { getElementById: () => ({}), querySelector: () => null, addEventListener() {} },
    setTimeout, clearTimeout, setInterval() { throw new Error('polling forbidden'); } };
  vm.runInNewContext(buildNativeClaudePreviewInjectionScript(), context);
  vm.runInNewContext(buildNativeClaudePreviewInjectionScript(), context);
  assert.equal(subscribers.size, 1);
  assert.equal(window.__cccClaudePreviewBlocks(id), false);
});

test('early installation creates subscription and later injection requests a render', () => {
  let scheduled = 0;
  const window = { addEventListener() {} };
  const context = { window, localStorage: { getItem: () => null },
    document: { getElementById: () => ({}), querySelector: () => null, addEventListener() {} },
    setTimeout() { scheduled++; return 1; }, clearTimeout() {} };
  vm.runInNewContext(buildNativeClaudePreviewInjectionScript(), context);
  assert.equal(window.__codexControlConsoleMutationSubscribers.size, 1);
  vm.runInNewContext(buildNativeClaudePreviewInjectionScript(), context);
  assert.equal(scheduled, 1);
  assert.equal(window.__codexControlConsoleMutationSubscribers.size, 1);
});

test('button mounts when composer arrives after installation and is not duplicated', () => {
  let routing = null, callback;
  const mounted = [], host = {};
  const window = { addEventListener() {} };
  const document = {
    getElementById: () => ({}),
    querySelector: selector => selector === '[data-codex-control-console-native-jev-current]' ? routing : null,
    querySelectorAll: () => [], addEventListener() {},
    createElement() {
      const attrs = new Map();
      return { dataset: {}, style: {}, addEventListener() {},
        setAttribute: (key, value) => attrs.set(key, value), getAttribute: key => attrs.get(key) };
    },
  };
  const context = { window, document, localStorage: { getItem: () => null },
    setTimeout(fn) { callback = fn; return 1; }, clearTimeout() {} };
  vm.runInNewContext(buildNativeClaudePreviewInjectionScript(), context);
  assert.equal(mounted.length, 0);
  routing = { parentElement: host, after(button) { button.parentElement = host; mounted.push(button); } };
  for (const notify of window.__codexControlConsoleMutationSubscribers) notify([]);
  callback();
  assert.equal(mounted.length, 1);
  assert.equal(mounted[0].textContent, 'Claude 预览');
  vm.runInNewContext(buildNativeClaudePreviewInjectionScript(), context); callback();
  assert.equal(mounted.length, 1);
});

test('panel styles update an already-installed legacy panel without duplicate styles or model changes', () => {
  let style, inserts = 0;
  const document = { getElementById: () => style, createElement: () => ({}), head: { append(value) { style = value; inserts++; } } };
  const context = { document };
  vm.runInNewContext(buildNativeClaudePanelStyleScript(), context);
  vm.runInNewContext(buildNativeClaudePanelStyleScript(), context);
  assert.equal(inserts, 1);
  assert.match(style.textContent, /select.*appearance:auto/);
  assert.match(style.textContent, /button.*min-height:36px/);
  assert.match(style.textContent, /data-claude-actions.*gap:8px/);
});
