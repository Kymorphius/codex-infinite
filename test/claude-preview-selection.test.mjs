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
  await c.set(id, 'medium', false);
  assert.equal(h.current().model, 'claude-subscription/opus');
  assert.equal(c.blocks(id), true); assert.equal(c.blocks(other), false);
  await c.set(id, 'high', false);
  const reloaded = createClaudePreviewSelection(h.options);
  assert.equal(reloaded.selected(id).effort, 'high');
  await reloaded.set(id, null);
  assert.deepEqual(h.current(), h.initial);
  assert.equal(reloaded.blocks(id), false);
  assert.deepEqual(reloaded.preferred(id), { effort: 'high', nativeTools: false, modelFamily: 'opus' });
  assert.deepEqual(createClaudePreviewSelection(h.options).preferred(id), { effort: 'high', nativeTools: false, modelFamily: 'opus' });
});
test('new Claude selections default to native tools and auto effort uses the native Router route', async () => {
  const h = harness();
  await h.controller.set(id, 'auto');
  assert.deepEqual(h.current(), { model: 'claude-subscription/opus-auto-native', reasoningEffort: 'medium' });
  assert.equal(h.controller.selected(id).effort, 'auto');
  assert.equal(h.controller.selected(id).nativeTools, true);
  await h.controller.set(id, null);
  assert.deepEqual(h.current(), h.initial);
  assert.deepEqual(h.controller.preferred(id), { effort: 'auto', nativeTools: true, modelFamily: 'opus' });
  await h.controller.set(id, 'auto', false);
  assert.equal(h.current().model, 'claude-subscription/opus-auto');
  await h.controller.set(id, null);
  assert.deepEqual(h.controller.preferred(id), { effort: 'auto', nativeTools: false, modelFamily: 'opus' });
});
test('model family persists across toggles and Haiku never receives an effort level', async () => {
  const h = harness();
  await h.controller.set(id, 'high', true, 'sonnet');
  assert.deepEqual(h.current(), { model: 'claude-subscription/sonnet-native', reasoningEffort: 'high' });
  await h.controller.set(id, 'auto', false, 'haiku');
  assert.deepEqual(h.current(), { model: 'claude-subscription/haiku', reasoningEffort: 'medium' });
  const reloaded = createClaudePreviewSelection(h.options);
  assert.equal(reloaded.selected(id).modelFamily, 'haiku');
  await reloaded.set(id, null);
  assert.deepEqual(h.current(), h.initial);
  assert.deepEqual(reloaded.preferred(id), { effort: 'auto', nativeTools: false, modelFamily: 'haiku' });
  await assert.rejects(reloaded.set(id, 'high', true, 'haiku'), /模型或推理强度/);
  await assert.rejects(reloaded.set(id, 'auto', true, 'fable'), /模型或推理强度/);
});
test('Opus planning and Sonnet execution mode persists with auto effort and native tools', async () => {
  const h = harness();
  await h.controller.set(id, 'auto', true, 'opusplan');
  assert.deepEqual(h.current(), { model: 'claude-subscription/opusplan-auto-native', reasoningEffort: 'medium' });
  const reloaded = createClaudePreviewSelection(h.options);
  assert.equal(reloaded.selected(id).modelFamily, 'opusplan');
  await reloaded.set(id, null);
  assert.deepEqual(reloaded.preferred(id), { effort: 'auto', nativeTools: true, modelFamily: 'opusplan' });
});
test('Claude aliases keep their own routes and auto-only choices reject fixed effort', async () => {
  const h = harness();
  for (const family of ['default', 'best', 'haiku-latest']) {
    await h.controller.set(id, 'auto', true, family);
    assert.equal(h.current().model, `claude-subscription/${family}-native`);
    await assert.rejects(h.controller.set(id, 'high', true, family), /模型或推理强度/);
  }
  for (const family of ['opus-latest', 'sonnet-latest', 'opusplan-latest', 'opus-1m', 'sonnet-1m']) {
    await h.controller.set(id, 'high', false, family);
    assert.equal(h.current().model, `claude-subscription/${family}`);
  }
  await h.controller.set(id, null);
  assert.equal(h.controller.preferred(id).modelFamily, 'sonnet-1m');
});
test('existing Opus preferences without a model field keep their original route', async () => {
  const h = harness();
  h.options.storage.setItem('codex-control-console.claude-preview-preference.v1', JSON.stringify([{ id, effort: 'high', nativeTools: true }]));
  const restored = createClaudePreviewSelection(h.options);
  assert.deepEqual(restored.preferred(id), { effort: 'high', nativeTools: true, modelFamily: 'opus' });
  await restored.set(id, 'high', true, restored.preferred(id).modelFamily);
  assert.equal(h.current().model, 'claude-subscription/opus-native');
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
  const context = { window, localStorage: { getItem: () => null }, document: { getElementById: () => ({}), querySelector: () => null, querySelectorAll: () => [], addEventListener() {} },
    setTimeout, clearTimeout, setInterval() { throw new Error('polling forbidden'); } };
  vm.runInNewContext(buildNativeClaudePreviewInjectionScript(), context);
  vm.runInNewContext(buildNativeClaudePreviewInjectionScript(), context);
  assert.equal(subscribers.size, 1);
  assert.equal(window.__cccClaudePreviewBlocks(id), false);
});
test('a reloaded service replaces the older Claude panel closure without reloading the conversation', () => {
  let removed = 0, oldRefreshes = 0;
  const stale = { remove() { removed++; } }, oldRefresh = () => { oldRefreshes++; };
  const subscribers = new Set([oldRefresh]);
  const window = { __cccClaudePreviewInstalled: true, __cccClaudePreviewRefresh: oldRefresh,
    __codexControlConsoleMutationSubscribers: subscribers, addEventListener() {} };
  const document = { getElementById: () => ({}), querySelector: selector => selector === '[data-ccc-claude-preview]' ? stale : null,
    querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} };
  vm.runInNewContext(buildNativeClaudePreviewInjectionScript(), { window, document,
    localStorage: { getItem: () => null }, setTimeout: () => 1, clearTimeout() {} });
  assert.ok(removed >= 1);
  assert.equal(oldRefreshes, 0);
  assert.equal(subscribers.has(oldRefresh), false);
  assert.equal(window.__cccClaudePreviewVersion, 4);
  assert.equal(typeof window.__cccClaudePreviewDispose, 'function');
});

test('page global set routes a thread through the recorded read-back path', async () => {
  const saved = new Map(), id = '019a0000-0000-7000-8000-00000000b001';
  let current = { model: 'gpt-6-sol', reasoningEffort: 'medium' };
  const window = { addEventListener() {}, __codexControlConsoleReadThreadSettings: async () => current,
    __codexControlConsoleApplyThreadSettings: async (_id, next) => { current = next; return { applied: true }; } };
  vm.runInNewContext(buildNativeClaudePreviewInjectionScript(), { window, document: { getElementById: () => ({}), querySelector: () => null, querySelectorAll: () => [], addEventListener() {} },
    localStorage: { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) }, setTimeout: () => 1, clearTimeout() {} });
  await window.__cccClaudePreviewSet(id, 'auto', false, 'opus');
  assert.deepEqual({ ...current }, { model: 'claude-subscription/opus-auto', reasoningEffort: 'medium' });
  assert.equal(window.__cccClaudePreviewBlocks(id), true);
  assert.equal(JSON.parse(saved.get('codex-control-console.claude-preview.v1'))[0].nativeTools, false);
});

test('early installation creates subscription and later injection requests a render', () => {
  let scheduled = 0;
  const window = { addEventListener() {} };
  const context = { window, localStorage: { getItem: () => null },
    document: { getElementById: () => ({}), querySelector: () => null, querySelectorAll: () => [], addEventListener() {} },
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
  assert.equal(mounted[0].textContent, 'GPT');
  vm.runInNewContext(buildNativeClaudePreviewInjectionScript(), context); callback();
  assert.equal(mounted.length, 1);
});

test('native button left click toggles Router model and right click opens the nearby settings panel', async () => {
  const saved = new Map(), panels = [], host = {};
  let scheduled;
  let button, current = { model: 'gpt-6-sol', reasoningEffort: 'medium' };
  function node() {
    const attrs = new Map(), events = new Map();
    return { dataset: {}, style: {}, events, children: [], textContent: '', offsetHeight: 220,
      setAttribute: (key, value) => attrs.set(key, value), getAttribute: key => attrs.get(key),
      addEventListener: (key, callback) => events.set(key, callback), removeEventListener() {},
      append(...items) { this.children.push(...items); }, prepend(item) { this.children.unshift(item); }, remove() {},
      getBoundingClientRect: () => ({ left: 130, top: 700, bottom: 728, width: 28 }) };
  }
  const selected = { getAttribute: () => 'local:' + id };
  const routing = { parentElement: host, after(value) { value.parentElement = host; button = value; } };
  const document = { getElementById: () => ({}), createElement: node, addEventListener() {}, removeEventListener() {},
    querySelector: selector => selector === '[data-codex-control-console-native-jev-current]' ? routing
      : selector.includes('data-app-action-sidebar-thread-id') ? selected : null,
    querySelectorAll: () => [], body: { append(value) { panels.push(value); } } };
  const window = { innerWidth: 1000, innerHeight: 900, addEventListener() {}, __cccClaudeRouterReady: () => true,
    __codexControlConsoleReadThreadSettings: async () => current,
    __codexControlConsoleApplyThreadSettings: async (_id, next) => { current = next; return { applied: true }; } };
  vm.runInNewContext(buildNativeClaudePreviewInjectionScript(), { window, document,
    localStorage: { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) },
    setTimeout: callback => { scheduled = callback; return 1; }, clearTimeout() {} });
  assert.match(button.style.cssText, /cursor:pointer/);
  const gesture = { button: 0, preventDefault() {}, stopImmediatePropagation() {} };
  button.events.get('pointerup')(gesture);
  await new Promise(resolve => setImmediate(resolve));
  scheduled();
  assert.equal(current.model, 'claude-subscription/opus-auto-native'); assert.equal(current.reasoningEffort, 'medium');
  assert.equal(button.style.borderColor, '#d97757');
  assert.equal(button.style.color, '#e9a58d');
  assert.equal(button.style.background, 'rgba(217,119,87,.16)');
  button.events.get('contextmenu')({ preventDefault() {}, stopImmediatePropagation() {} });
  assert.equal(panels.at(-1).dataset.cccClaudePreviewPanel, '');
  assert.equal(panels.at(-1).style.left, '130px');
  assert.deepEqual(panels.at(-1).children[2].children[0].children.map(option => option.textContent), [
    'Opus 5.5', 'Sonnet 5.5', 'Haiku 4.5', 'Opus 5.5 规划 / Sonnet 5.5 执行',
    '默认（随账号变化）', 'best（可能使用额外 usage credits）', 'Opus 最新（随 Claude 更新）',
    'Sonnet 最新（随 Claude 更新）', 'Haiku 最新（随 Claude 更新）', 'Opus 规划 / Sonnet 执行（随 Claude 更新）',
    'Opus 最新 · 1M（需账号支持）', 'Sonnet 最新 · 1M（需账号支持）',
  ]);
  assert.equal(panels.at(-1).children[4].children[0].checked, true);
  panels.at(-1).children[4].children[0].checked = false;
  panels.at(-1).children[3].children[0].value = 'high';
  panels.at(-1).children[2].children[0].value = 'sonnet';
  panels.at(-1).children[6].children[0].onclick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(current.reasoningEffort, 'high');
  assert.equal(current.model, 'claude-subscription/sonnet');
  scheduled(); assert.equal(button.textContent, 'Claude Sonnet 5.5');
  button.events.get('pointerup')(gesture);
  await new Promise(resolve => setImmediate(resolve));
  scheduled();
  assert.equal(current.model, 'gpt-6-sol'); assert.equal(current.reasoningEffort, 'medium');
  assert.equal(button.style.borderColor, '');
  assert.equal(button.style.background, '');
  button.events.get('pointerup')(gesture);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(current.model, 'claude-subscription/sonnet'); assert.equal(current.reasoningEffort, 'high');
  button.events.get('contextmenu')({ preventDefault() {}, stopImmediatePropagation() {} });
  const haikuPanel = panels.at(-1), haikuModel = haikuPanel.children[2].children[0], haikuEffort = haikuPanel.children[3].children[0];
  haikuModel.value = 'haiku'; haikuModel.onchange();
  assert.equal(haikuEffort.value, 'auto'); assert.equal(haikuEffort.disabled, true);
  haikuPanel.children[6].children[0].onclick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(current.model, 'claude-subscription/haiku'); assert.equal(current.reasoningEffort, 'medium');
  button.events.get('contextmenu')({ preventDefault() {}, stopImmediatePropagation() {} });
  const hybridPanel = panels.at(-1);
  hybridPanel.children[2].children[0].value = 'opusplan';
  hybridPanel.children[2].children[0].onchange();
  assert.equal(hybridPanel.children[3].children[0].disabled, false);
  hybridPanel.children[6].children[0].onclick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(current.model, 'claude-subscription/opusplan-auto');
  scheduled(); assert.equal(button.textContent, 'Claude OpusPlan 5.5');
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
