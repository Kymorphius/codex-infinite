import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installNativeTerminalView } from '../src/native-terminal-view.mjs';
import { nativeLayoutTransition } from '../src/native-entry-probe.mjs';
import { buildInjectionScript } from '../src/injection.mjs';
import { Node } from '../test-support/native-terminal-view-node.mjs';

test('a terminal view whose root was removed by someone else takes its title bar down', () => {
  const created = [], observers = [];
  let disposals = 0;
  const html = new Node('html'), head = new Node('head'), toolbar = new Node('toolbar');
  const window = { __cccTerminalNative: { socketClass: () => class {}, async request() { assert.fail('cleanup must not stop or start the PTY'); } } };
  const documentRef = { documentElement: html, head, body: new Node('body'), getElementById: () => null,
    querySelector: selector => selector.includes('data-app-shell-header-toolbar') ? toolbar : null,
    createElement(tag) { const node = new Node(tag); created.push(node); return node; } };
  const context = vm.createContext({ window, document: documentRef, MutationObserver: class { constructor(fn) { observers.push(fn); } observe() {} disconnect() {} }, requestAnimationFrame: fn => fn(),
    sessionStorage: { getItem() {}, setItem() {} } });
  context.createSession = (session, options) => ({ activate() { options.onChange({ session, connection: 'connected', canInput: true }); }, snapshot: () => ({ canInput: true }), dispose() { disposals++; } });
  vm.runInContext(`(${installNativeTerminalView.toString()})(createSession, () => '', '')`, context);
  const record = { id: 's', title: 'Claude', kind: 'claude', runtimeSessionId: 'p', runtimeSummary: { id: 'p', kind: 'claude', status: 'running' }, status: 'running' };
  const host = new Node('main'), nativeContent = new Node('article');
  nativeContent.style.display = 'flex'; host.append(nativeContent);
  window.__cccOpenNativeTerminal(record, host);
  assert.equal(html.attributes['data-ccc-terminal-titlebar'], '');
  const root = created.find(node => node.attributes?.['data-codex-control-console-workspace'] !== undefined);
  root.isConnected = true;
  for (const notify of observers) notify([]);
  assert.equal(disposals, 0, 'a mounted view survives unrelated mutations');
  assert.equal(nativeContent.style.display, 'none');
  root.isConnected = false;
  for (const notify of observers) notify([]);
  assert.equal(html.attributes['data-ccc-terminal-titlebar'], undefined, 'the header is given back');
  assert.equal(toolbar.children.some(node => node.attributes?.['data-ccc-terminal-titlebar-content'] !== undefined), false);
  assert.equal(nativeContent.style.display, 'flex');
  assert.equal(window.__cccNativeTerminalView, null);
  for (const notify of observers) notify([]);
  assert.equal(disposals, 1, 'orphan cleanup is idempotent');
});

test('leaving the normal layout (settings) is detected exactly once', () => {
  let normal = true;
  const documentRef = { querySelector: selector => selector === '[data-app-action-sidebar-scroll]' && normal ? {} : null };
  assert.deepEqual(nativeLayoutTransition(documentRef, false), { normal: true, leftNormal: false });
  normal = false;
  assert.deepEqual(nativeLayoutTransition(documentRef, true), { normal: false, leftNormal: true });
  assert.deepEqual(nativeLayoutTransition(documentRef, false), { normal: false, leftNormal: false });
  normal = true;
  assert.deepEqual(nativeLayoutTransition(documentRef, false), { normal: true, leftNormal: false });
});

test('layout detection is self-contained when serialized into a fresh renderer', () => {
  const result = vm.runInNewContext(`(${nativeLayoutTransition.toString()})({ querySelector: () => null }, true)`);
  assert.equal(result.normal, false);
  assert.equal(result.leftNormal, true);
});

test('the injected script closes the overlay and terminal on settings and never anchors entries there', () => {
  const source = buildInjectionScript('http://127.0.0.1:47831');
  assert.match(source, /if \(layout\.leftNormal\) \{ cancelTerminalNavigation\(\); restoreWorkspace\(\); \}/);
  assert.match(source, /const anchor = layout\.normal \? nativeAnchor\(\) : null;/);
  assert.match(source, /requestEmbeddedFramePreparation\(module, terminalTarget\)\) return; window\.__cccNativeTerminalView\?\.dispose\(\);/);
});
