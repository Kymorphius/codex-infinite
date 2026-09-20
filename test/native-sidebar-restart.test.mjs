import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildNativeSidebarRestartInjectionScript } from '../src/native-sidebar-restart.mjs';
import { resolveStaticAsset } from '../src/static-assets.mjs';
test('sidebar shortcut is adjacent to help and confirmation cancellation requires its own frame and origin', async () => {
  class Node {
    constructor(tag) { this.tag = tag; this.style = {}; this.children = []; this.attrs = {}; this.listeners = {}; this.contentWindow = {}; }
    append(...children) { for (const child of children) { this.children.push(child); child.isConnected = true; child.parent = this; } }
    setAttribute(k, v) { this.attrs[k] = v; }
    addEventListener(k, fn) { this.listeners[k] = fn; }
    getBoundingClientRect() { return { width: this.children.filter(child => child.tag !== 'style').length > 1 ? 76 : 32 }; }
    remove() { this.isConnected = false; if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); }
  }
  const body = new Node('body'), help = { className: 'native-help', getBoundingClientRect: () => ({ left: 10, right: 42, top: 500, width: 32, height: 32 }) };
  const listeners = {}, win = { innerWidth: 1000, innerHeight: 600, addEventListener(k, fn) { listeners[k] = fn; }, removeEventListener() {} };
  const launches = [];
  const context = vm.createContext({ URL, fetch: async (url, options) => { launches.push([url.href, options]); return { ok: true }; }, window: win, document: { body, documentElement: body, createElement: tag => new Node(tag), querySelector: () => help },
    getComputedStyle: () => ({ colorScheme: 'dark' }), MutationObserver: class { observe() {} disconnect() {} }, requestAnimationFrame: fn => fn() });
  vm.runInContext(buildNativeSidebarRestartInjectionScript('http://127.0.0.1:47831'), context);
  const root = body.children[0], version = root.children[0], nativeButton = root.children[1], button = root.children[2];
  assert.equal(root.style.left, '46px'); assert.equal(version.textContent, 'v0.1.0'); assert.equal(version.attrs['aria-label'], 'Codex Infinite 版本');
  assert.equal(nativeButton.textContent, '原生'); assert.equal(nativeButton.attrs['aria-label'], '启动原生 Codex');
  assert.equal(button.textContent, '重启'); assert.equal(body.children.length, 1);
  await nativeButton.listeners.click(); assert.equal(launches[0][0], 'http://127.0.0.1:47831/api/native-app/launch'); assert.equal(launches[0][1].method, 'POST'); assert.equal(launches[0][1].headers['content-type'], 'application/json'); assert.equal(launches[0][1].body, '{}');
  button.listeners.click(); const frame = body.children[1];
  assert.equal(frame.src, 'http://127.0.0.1:47831/restart.html?theme=dark');
  listeners.message({ source: {}, origin: 'http://127.0.0.1:47831', data: { type: 'codex-control-console-restart-cancel' } }); assert.equal(frame.isConnected, true);
  listeners.message({ source: frame.contentWindow, origin: 'https://evil.example', data: { type: 'codex-control-console-restart-cancel' } }); assert.equal(frame.isConnected, true);
  listeners.message({ source: frame.contentWindow, origin: 'http://127.0.0.1:47831', data: { type: 'codex-control-console-restart-cancel' } }); assert.equal(frame.isConnected, false);
  assert.equal(button.attrs['aria-expanded'], 'false');
  win.__codexControlConsoleSidebarRestart.dispose(); assert.equal(body.children.length, 0);
});
test('confirmation page and script are explicitly served', () => {
  assert.ok(resolveStaticAsset('/restart.html')); assert.ok(resolveStaticAsset('/features/runtime/sidebar.js'));
});
