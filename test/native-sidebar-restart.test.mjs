import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildNativeSidebarRestartInjectionScript } from '../src/native-sidebar-restart.mjs';
import { resolveStaticAsset } from '../src/static-assets.mjs';
test('restart appears as a Help menu item and keeps exact-origin confirmation', async () => {
  class Node {
    constructor(tag) { this.tag = tag; this.style = {}; this.children = []; this.attrs = {}; this.listeners = {}; this.contentWindow = {}; }
    append(...children) { for (const child of children) { child.remove(); this.children.push(child); child.isConnected = true; child.parentElement = this; } }
    setAttribute(k, v) { this.attrs[k] = v; }
    getAttribute(k) { return this.attrs[k] || null; }
    querySelector(selector) { return selector === '[role="menuitem"]' ? this.children.find(child => child.attrs.role === 'menuitem') : null; }
    addEventListener(k, fn) { this.listeners[k] = fn; }
    getBoundingClientRect() { return { left: 700, right: 750, top: 5, bottom: 33, width: 50, height: 28 }; }
    remove() { this.isConnected = false; if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null; }
  }
  const body = new Node('body'); let tabs = new Node('nav'); body.append(tabs);
  const help = new Node('button'); help.setAttribute('aria-label', 'Help menu'); help.setAttribute('aria-controls', 'help-content'); help.setAttribute('aria-expanded', 'false');
  let menu = new Node('menu'); const existingItem = new Node('button'); existingItem.setAttribute('role', 'menuitem'); existingItem.className = 'native-menu-item'; menu.append(existingItem);
  const listeners = {}, win = { innerWidth: 1000, innerHeight: 600, addEventListener(k, fn) { listeners[k] = fn; }, removeEventListener() {} };
  const launches = []; let notifyMutation;
  const document = { body, documentElement: body, createElement: tag => new Node(tag), querySelector: selector => selector === '[data-codex-control-console-native-tabs]' ? tabs : selector.includes('Help menu') ? help : null,
    getElementById: id => id === 'help-content' && menu.isConnected ? menu : null, querySelectorAll: () => [] };
  const context = vm.createContext({ URL, fetch: async (url, options) => { launches.push([url.href, options]); return { ok: true }; }, window: win, document,
    getComputedStyle: () => ({ colorScheme: 'dark' }), MutationObserver: class { constructor(callback) { notifyMutation = callback; } observe() {} disconnect() {} }, requestAnimationFrame: fn => fn() });
  vm.runInContext(buildNativeSidebarRestartInjectionScript('http://127.0.0.1:47831'), context);
  const root = tabs.children[0], version = root.children[0], nativeButton = root.children[1];
  assert.equal(root.parentElement, tabs); assert.equal(version.textContent, 'v0.1.0'); assert.equal(version.attrs['aria-label'], 'Codex Infinite 版本');
  assert.equal(nativeButton.textContent, '原生'); assert.equal(nativeButton.attrs['aria-label'], '启动原生 Codex');
  assert.equal(root.children.length, 2); assert.equal(menu.children.length, 1);
  help.setAttribute('aria-expanded', 'true'); body.append(menu); notifyMutation();
  const button = menu.children[1]; assert.equal(button.textContent, '重启加强版'); assert.equal(button.attrs.role, 'menuitem'); assert.equal(button.className, 'native-menu-item');
  tabs.remove(); tabs = new Node('nav'); body.append(tabs); notifyMutation();
  assert.equal(root.parentElement, tabs);
  menu.remove(); menu = new Node('menu'); menu.append(existingItem); body.append(menu); notifyMutation();
  assert.equal(button.parentElement, menu); assert.equal(menu.children.length, 2);
  await nativeButton.listeners.click(); assert.equal(launches[0][0], 'http://127.0.0.1:47831/api/native-app/launch'); assert.equal(launches[0][1].method, 'POST'); assert.equal(launches[0][1].headers['content-type'], 'application/json'); assert.equal(launches[0][1].body, '{}');
  button.listeners.click(); const frame = body.children.at(-1);
  assert.equal(frame.src, 'http://127.0.0.1:47831/restart.html?theme=dark');
  assert.equal(frame.style.top, '41px');
  listeners.message({ source: {}, origin: 'http://127.0.0.1:47831', data: { type: 'codex-control-console-restart-cancel' } }); assert.equal(frame.isConnected, true);
  listeners.message({ source: frame.contentWindow, origin: 'https://evil.example', data: { type: 'codex-control-console-restart-cancel' } }); assert.equal(frame.isConnected, true);
  listeners.message({ source: frame.contentWindow, origin: 'http://127.0.0.1:47831', data: { type: 'codex-control-console-restart-cancel' } }); assert.equal(frame.isConnected, false);
  win.__codexControlConsoleSidebarRestart.dispose(); assert.equal(tabs.children.length, 0); assert.equal(menu.children.length, 1);
});
test('confirmation page and script are explicitly served', () => {
  assert.ok(resolveStaticAsset('/restart.html')); assert.ok(resolveStaticAsset('/features/runtime/sidebar.js'));
});
