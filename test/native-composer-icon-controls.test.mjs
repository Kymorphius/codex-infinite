import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { NATIVE_COMPOSER_ICON_CONTROLS, NATIVE_COMPOSER_ICON_STYLE, buildNativeComposerIconControlsSource, describeComposerIconControl } from '../src/native-composer-icon-controls.mjs';

test('labels become badge, tooltip and accessible name', () => {
  assert.deepEqual(describeComposerIconControl('领任务 32', null), { badge: '32', tooltip: '领任务 32', ariaLabel: '领任务 32' });
  assert.deepEqual(describeComposerIconControl(' 待办  1 ', null), { badge: '1', tooltip: '待办 1', ariaLabel: '待办 1' });
  assert.deepEqual(describeComposerIconControl('存待办', null), { badge: '', tooltip: '存待办', ariaLabel: '存待办' });
  assert.equal(describeComposerIconControl('待办 0', null).badge, '', 'a zero count shows no badge');
  assert.deepEqual(describeComposerIconControl('路由', '当前会话 Jev 自动分流已关闭'), { badge: '', tooltip: '当前会话 Jev 自动分流已关闭', ariaLabel: null }, "an owner's aria-label is kept");
});

test('every registered control has a masked icon and the style hides text only visually', () => {
  assert.deepEqual(NATIVE_COMPOSER_ICON_CONTROLS.map(([name]) => name), ['save', 'queue', 'claim', 'context', 'routing', 'claude']);
  for (const [name] of NATIVE_COMPOSER_ICON_CONTROLS) assert.match(NATIVE_COMPOSER_ICON_STYLE, new RegExp(`\\[data-ccc-icon="${name}"\\]\\{--ccc-icon:url\\("data:image/svg\\+xml,`));
  assert.match(NATIVE_COMPOSER_ICON_STYLE, /\[data-ccc-icon\]\{display:inline-flex!important;font-size:0!important;flex:0 0 28px!important;width:28px!important/, 'every control centers its icon, whatever its own display');
  assert.match(NATIVE_COMPOSER_ICON_STYLE, /\[data-ccc-icon\]\[data-ccc-badge\]::after\{content:attr\(data-ccc-badge\)/);
  assert.doesNotMatch(NATIVE_COMPOSER_ICON_STYLE, /turn-state/, 'the 780 readout stays a number');
});

class Node {
  constructor(attrs = {}, text = '') { this.nodeType = 1; this.attrs = { ...attrs }; this.textContent = text; }
  getAttribute(name) { return Object.hasOwn(this.attrs, name) ? this.attrs[name] : null; }
  setAttribute(name, value) { this.attrs[name] = String(value); } removeAttribute(name) { delete this.attrs[name]; }
  hasAttribute(name) { return Object.hasOwn(this.attrs, name); } remove() { this.removed = true; }
}

test('the installer marks live controls, refreshes on change and restores on dispose', () => {
  const claim = new Node({ 'data-ccc-claim-task': '' }, '领任务 32');
  const routing = new Node({ 'data-codex-control-console-native-jev-current': '', 'aria-label': '当前会话 Jev 自动分流已关闭' }, '路由');
  const nodes = [claim, routing], head = { children: [], append(node) { this.children.push(node); } };
  const document = { head, documentElement: {}, createElement: () => new Node(),
    querySelectorAll: (selector) => selector === '[data-ccc-icon]' ? nodes.filter((node) => node.hasAttribute('data-ccc-icon')) : nodes.filter((node) => Object.keys(node.attrs).some((name) => selector === `[${name}]`)) };
  const window = {};
  vm.runInNewContext(buildNativeComposerIconControlsSource(), { window, document, MutationObserver: class { observe() {} disconnect() {} }, queueMicrotask });
  assert.equal(claim.attrs['data-ccc-icon'], 'claim'); assert.equal(claim.attrs['data-ccc-badge'], '32'); assert.equal(claim.attrs['aria-label'], '领任务 32'); assert.equal(claim.attrs.title, '领任务 32');
  assert.equal(routing.attrs['aria-label'], '当前会话 Jev 自动分流已关闭'); assert.equal(routing.attrs.title, '当前会话 Jev 自动分流已关闭'); assert.equal(routing.attrs['data-ccc-badge'], undefined);
  claim.textContent = '领任务 5'; window.__cccComposerIconControls.apply();
  assert.equal(claim.attrs['data-ccc-badge'], '5'); assert.equal(claim.attrs['aria-label'], '领任务 5', 'our own aria-label follows the label');
  window.__cccComposerIconControls.dispose();
  assert.deepEqual(claim.attrs, { 'data-ccc-claim-task': '' });
  assert.deepEqual(routing.attrs, { 'data-codex-control-console-native-jev-current': '', 'aria-label': '当前会话 Jev 自动分流已关闭' });
  assert.equal(head.children[0].removed, true);
});

test("an owner's title is kept, so the icon layer and the owner stop trading values every sync", () => {
  // Regression: claim-task and claude-preview each write their own title; the icon layer replaced it
  // with a label-derived tooltip on every sync and the owner wrote it back (24 real changes per 10s).
  const claim = new Node({ 'data-ccc-claim-task': '', title: '领取未指派任务，填入输入框并发送创建新会话' }, '领任务 33');
  const claude = new Node({ 'data-ccc-claude-preview': '', 'aria-label': '切换 GPT 与 Claude；右键打开设置', title: 'GPT · 左键切换 Claude，右键设置' }, 'GPT');
  const nodes = [claim, claude], head = { children: [], append(node) { this.children.push(node); } };
  const document = { head, documentElement: {}, createElement: () => new Node(),
    querySelectorAll: (selector) => selector === '[data-ccc-icon]' ? nodes.filter((node) => node.hasAttribute('data-ccc-icon')) : nodes.filter((node) => Object.keys(node.attrs).some((name) => selector === `[${name}]`)) };
  const window = {}, writes = [];
  for (const node of nodes) { const original = node.setAttribute.bind(node); node.setAttribute = (name, value) => { if (name === 'title') writes.push(value); original(name, value); }; }
  vm.runInNewContext(buildNativeComposerIconControlsSource(), { window, document, MutationObserver: class { observe() {} disconnect() {} }, queueMicrotask });
  for (let i = 0; i < 4; i++) window.__cccComposerIconControls.apply();
  assert.equal(claim.attrs.title, '领取未指派任务，填入输入框并发送创建新会话'); assert.equal(claude.attrs.title, 'GPT · 左键切换 Claude，右键设置');
  assert.deepEqual(writes, [], 'no title write when the owner already set one');
  assert.equal(claim.attrs['data-ccc-badge'], '33', 'icon and badge are still ours');
  claim.attrs.title = '综合任务清单当前没有未指派任务'; window.__cccComposerIconControls.apply();
  assert.equal(claim.attrs.title, '综合任务清单当前没有未指派任务', "a changed owner title still wins");
  delete claude.attrs.title; window.__cccComposerIconControls.apply();
  assert.equal(claude.attrs.title, '切换 GPT 与 Claude；右键打开设置', 'without an owner title the derived tooltip fills in');
  window.__cccComposerIconControls.apply();
  assert.equal(writes.length, 1, 'and then stays put');
  window.__cccComposerIconControls.dispose();
  assert.equal(claim.attrs.title, '综合任务清单当前没有未指派任务', "dispose leaves an owner's title alone");
  assert.equal(claude.attrs.title, undefined, 'and removes only the title it wrote');
});

test('both injectors install the icon layer', async () => {
  for (const file of ['src/injector.mjs', 'src/native-owner-injector.mjs']) assert.match(await fs.readFile(file, 'utf8'), /buildNativeComposerIconControlsSource\(\)/);
});
