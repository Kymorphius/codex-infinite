import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installNativeTerminalView } from '../src/native-terminal-view.mjs';
import { Node } from '../test-support/native-terminal-view-node.mjs';
test('a pinned native header reserves its rows so the terminal does not draw under the title bar', () => {
  // Regression: Windows ChatGPT pins the header (position:fixed) over the page; the terminal started
  // at the same top and its output was painted under the title bar. An in-flow header (macOS) adds nothing.
  const header = { position: 'fixed', getBoundingClientRect: () => ({ bottom: 115 }) };
  const toolbar = new Node('toolbar'); toolbar.closest = selector => selector === 'header' ? header : null;
  const created = []; let resize = null, mutate = null, liveToolbar = toolbar;
  const html = new Node('html'), head = new Node('head');
  const documentRef = { documentElement: html, head, body: new Node('body'), getElementById: () => null, querySelector: selector => selector.includes('data-app-shell-header-toolbar') ? liveToolbar : null,
    createElement(tag) { const node = new Node(tag); node.getBoundingClientRect = () => ({ top: 53, height: 120 }); created.push(node); return node; } };
  const context = vm.createContext({ window: { __cccTerminalNative: { socketClass: () => class {}, async request() {} } }, document: documentRef,
    MutationObserver: class { constructor(fn) { mutate ||= fn; } observe() {} disconnect() {} }, ResizeObserver: class { constructor(fn) { resize ||= fn; } observe() {} disconnect() {} },
    getComputedStyle: node => ({ position: node.position || 'static', height: '100px' }), requestAnimationFrame: fn => fn(), sessionStorage: { getItem() {}, setItem() {} } });
  context.createSession = () => ({ activate() {}, snapshot: () => ({}), dispose() {} });
  vm.runInContext(`(${installNativeTerminalView.toString()})(createSession, () => '', '')`, context);
  const host = new Node('main'); host.closest = () => null;
  assert.equal(context.window.__cccOpenNativeTerminal({ id: 'session', title: 'Claude', kind: 'claude', status: 'stopped' }, host), true);
  const layout = created.find(node => node.className === 'layout');
  // The page is CSS-zoomed 1.2x (rendered 120px vs CSS 100px): 62 rendered px are 51.7 CSS px. The earlier code
  // wrote 62 (and +8) as CSS px, which rendered as an empty band above the terminal.
  assert.equal(layout.style.paddingTop, '51.7px', 'exactly the pinned header, converted to CSS px, with no extra gap');
  const output = created.find(node => node.className === 'output');
  assert.equal(output.style.paddingTop, '2px', 'the terminal starts right under the title bar');
  header.position = 'static'; resize();
  assert.equal(layout.style.paddingTop, '0px', 'an in-flow header reserves nothing, but the terminal still hugs the title bar');
  assert.equal(output.style.paddingTop, '2px');
  liveToolbar = null; mutate();
  assert.equal(layout.style.paddingTop, '', 'without a native header (title bar falls back into the view) the normal padding returns');
  assert.equal(output.style.paddingTop, '');
});

test('page DOM churn does not make the placed title bar rewrite <html> or re-read the header', () => {
  // Regression: placeTitle ran on every page mutation and re-set <html data-ccc-terminal-titlebar>
  // and re-read header geometry each time, restyling the ~7.6k-node sidebar (~100ms per frame).
  const header = { position: 'fixed', getBoundingClientRect: () => ({ bottom: 115 }) };
  const toolbar = new Node('toolbar'); toolbar.closest = () => header;
  const html = new Node('html'), head = new Node('head'); let htmlWrites = 0, styleReads = 0, onMutation = null;
  const setAttribute = html.setAttribute.bind(html); html.setAttribute = (name, value) => { htmlWrites++; setAttribute(name, value); };
  const documentRef = { documentElement: html, head, body: new Node('body'), getElementById: () => null, querySelector: selector => selector.includes('data-app-shell-header-toolbar') ? toolbar : null,
    createElement(tag) { const node = new Node(tag); node.getBoundingClientRect = () => ({ top: 53 }); return node; } };
  const context = vm.createContext({ window: { __cccTerminalNative: { socketClass: () => class {}, async request() {} } }, document: documentRef,
    MutationObserver: class { constructor(fn) { onMutation ||= fn; } observe() {} disconnect() {} }, ResizeObserver: class { observe() {} disconnect() {} },
    getComputedStyle: node => { styleReads++; return { position: node.position || 'static' }; }, requestAnimationFrame: fn => fn(), sessionStorage: { getItem() {}, setItem() {} } });
  context.createSession = () => ({ activate() {}, snapshot: () => ({}), dispose() {} });
  vm.runInContext(`(${installNativeTerminalView.toString()})(createSession, () => '', '')`, context);
  const host = new Node('main'); host.closest = () => null;
  context.window.__cccOpenNativeTerminal({ id: 'session', title: 'Claude', kind: 'claude', status: 'stopped' }, host);
  const [writes, reads] = [htmlWrites, styleReads];
  assert.equal(writes, 1); assert.ok(reads >= 1, 'placement measures the header once');
  for (let i = 0; i < 20; i++) onMutation();
  assert.deepEqual([htmlWrites, styleReads], [writes, reads], 'unchanged placement writes and reads nothing');
});
