import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createNativeRouterStatusBinding, parseRouterStatusRequest, presentRouterStatus, NATIVE_ROUTER_STATUS_BINDING } from '../src/native-router-status.mjs';

const stopped = { status: 'stopped', reason: 'Router 服务未加载到 launchd', repair: 'bootstrap', service: { state: 'not loaded' }, health: null,
  lastRepair: { trigger: 'auto', action: 'bootstrap', ok: false, message: 'Bootstrap failed: 5' } };

test('presentation offers repair only for repairable states and summarizes the last repair', () => {
  const view = presentRouterStatus(stopped);
  assert.equal(view.status, 'stopped'); assert.equal(view.repair, 'bootstrap'); assert.match(view.confirm, /LaunchAgent/);
  assert.match(view.title, /最近自动启动：失败 Bootstrap failed: 5/); assert.match(view.title, /点击启动 Router/);
  assert.deepEqual(presentRouterStatus({ status: 'ready', repair: null, health: { version: '0.6.0' }, service: { state: 'running', pid: 7 } }),
    { status: 'ready', title: 'Router：运行中\n版本 0.6.0\nlaunchd：running (pid 7)', repair: null, confirm: null });
  assert.equal(presentRouterStatus({ status: 'weird', repair: 'rm' }).repair, null);
  assert.equal(presentRouterStatus(null).status, 'unknown');
});

test('binding accepts only status and repair requests and answers through the page hook', async () => {
  assert.equal(parseRouterStatusRequest('{"kind":"repair","action":"kickstart"}'), null);
  assert.equal(parseRouterStatusRequest('nope'), null);
  const calls = [], evaluated = [];
  const supervisor = { snapshot: stopped, read: async () => { calls.push('read'); return stopped; }, repair: async () => { calls.push('repair'); throw new Error('Router 当前无需修复'); } };
  const binding = createNativeRouterStatusBinding(supervisor);
  assert.equal(binding.name, NATIVE_ROUTER_STATUS_BINDING);
  const connection = { evaluate: async (expression) => evaluated.push(expression) };
  assert.equal(await binding.handle('{"kind":"other"}', connection), null);
  assert.equal((await binding.handle('{"kind":"status"}', connection)).status, 'stopped');
  const failed = await binding.handle('{"kind":"repair"}', connection);
  assert.deepEqual(calls, ['read', 'repair']); assert.equal(failed.message, 'Router 当前无需修复'); assert.equal(failed.status, 'stopped');
  assert.match(evaluated[0], /^window\.__codexControlConsoleRouterStatus\?\.apply\(/);
});

function fakePage() {
  const make = (attrs = {}) => ({ attrs, style: {}, dataset: {}, listeners: {}, parentElement: null, nextElementSibling: null,
    setAttribute(name, value) { this.attrs[name] = value; }, getAttribute(name) { return name in this.attrs ? this.attrs[name] : null; },
    removeAttribute(name) { delete this.attrs[name]; }, addEventListener(type, listener) { this.listeners[type] = listener; },
    parts: {}, querySelector(selector) { return this.parts[selector] || (this.parts[selector] = { style: {}, className: '' }); },
    get isConnected() { return Boolean(this.parentElement); }, getBoundingClientRect: () => ({ top: 700, right: 44, height: 36 }), offsetHeight: 40,
    append(child) { child.parentElement = this; this.lastTooltip = child; }, remove() { this.parentElement = null; } });
  const sample = make({ class: '_Button ghost', 'data-variant': 'ghost', 'data-size': 'xl' });
  sample.parts[':scope > span'] = { className: '_ButtonInner' };
  const list = make(), profile = make();
  const rail = { children: [list, profile], querySelector: () => sample,
    insertBefore(node, before) { this.children = this.children.filter((child) => child !== node); this.children.splice(this.children.indexOf(before), 0, node); node.parentElement = this; node.nextElementSibling = before; } };
  const sent = [];
  const window = { confirm: () => true };
  window[NATIVE_ROUTER_STATUS_BINDING] = (payload) => sent.push(JSON.parse(payload).kind);
  const document = { visibilityState: 'visible', documentElement: {}, body: make(), createElement: () => make(), querySelector: (selector) => selector.includes('sidebar-rail') ? rail : null };
  window.window = window; window.document = document; window.innerHeight = 900;
  Object.assign(window, { MutationObserver: class { observe() {} disconnect() {} }, requestAnimationFrame: (fn) => fn(), setInterval: () => 1, clearInterval() {} });
  return { window, rail, profile, sent };
}

test('page script docks above the rail profile with native look, renders status and confirms repair once', () => {
  const page = fakePage();
  const context = vm.createContext(page.window);
  vm.runInContext(createNativeRouterStatusBinding({}).source, context);
  const button = page.rail.children[1];
  assert.equal(page.rail.children.length, 3); assert.equal(button.nextElementSibling, page.profile);
  assert.equal(button.attrs.class, '_Button ghost'); assert.equal(button.attrs['data-variant'], 'ghost');
  assert.equal(button.parts['[data-router-inner]'].className, '_ButtonInner', 'icon uses the native centering wrapper');
  assert.deepEqual(page.sent, ['status']);
  vm.runInContext(createNativeRouterStatusBinding({}).source, context);
  assert.deepEqual(page.sent, ['status'], 'reinstall with the same version is a no-op');
  page.window.__codexControlConsoleRouterStatus.apply(presentRouterStatus({ status: 'ready', repair: null }));
  const dot = button.parts['[data-router-dot]'];
  assert.equal(button.dataset.routerState, 'ready'); assert.equal(dot.style.background, '#29a568');
  button.listeners.mouseenter();
  const tooltip = page.window.document.body.lastTooltip;
  assert.equal(tooltip.style.display, 'block'); assert.equal(tooltip.textContent, 'Router：运行中'); assert.equal(tooltip.style.left, '50px');
  button.listeners.mouseleave(); assert.equal(tooltip.style.display, 'none');
  button.listeners.click(); assert.deepEqual(page.sent, ['status']);
  page.window.__codexControlConsoleRouterStatus.apply(presentRouterStatus(stopped));
  assert.equal(dot.style.background, '#d64545');
  button.listeners.click(); button.listeners.click();
  assert.deepEqual(page.sent, ['status', 'repair']);
});
