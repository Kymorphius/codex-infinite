import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installNativeTerminalView } from '../src/native-terminal-view.mjs';
class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.style = {}; this.value = ''; this.attributes = {}; }
  setAttribute(name, value) { this.attributes[name] = value; } addEventListener() {}
  get parentNode() { return this.parent || null; }
  removeAttribute(name) { delete this.attributes[name]; }
  append(...nodes) { for (const node of nodes) { node.remove(); node.parent = this; this.children.push(node); } }
  prepend(...nodes) { for (const node of nodes.reverse()) { node.remove(); node.parent = this; this.children.unshift(node); } }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); this.parent = null; }
  replaceChildren() { this.children = []; }
  attachShadow() { this.shadowRoot = new Node('shadow'); return this.shadowRoot; }
}
test('native conversation mounts full terminal and composer, preserves draft, and restores host without stopping PTY', async () => {
  const surface = { style: { value: '', priority: '', getPropertyValue() { return this.value; }, getPropertyPriority() { return this.priority; }, setProperty(name, value, priority) { this.value = value; this.priority = priority; } } };
  const host = new Node('main'), original = new Node('conversation'); original.style.display = 'flex'; host.append(original); host.closest = selector => selector.includes('_MainContentSurface_') ? surface : null;
  const created = [], actions = [], keys = []; let disposed = 0, activated = 0, pasted, keyResult;
  const window = { __cccTerminalNative: { socketClass: () => class {}, async request(operation) { actions.push(operation); } } };
  const drafts = new Map();
  const html = new Node('html'), head = new Node('head'), toolbar = new Node('toolbar'), nativeTitle = new Node('native-title'); toolbar.append(nativeTitle);
  let headerToolbar = toolbar;
  const documentRef = { documentElement: html, head, body: new Node('body'), getElementById: id => head.children.find(node => node.id === id) || null,
    querySelector: selector => selector.includes('data-app-shell-header-toolbar') ? headerToolbar : null,
    createElement(tag) { const node = new Node(tag); created.push(node); return node; } };
  const context = vm.createContext({ window, document: documentRef, MutationObserver: class { observe() {} disconnect() {} }, requestAnimationFrame: fn => fn(),
    sessionStorage: { getItem: key => drafts.get(key), setItem: (key, value) => drafts.set(key, value) } });
  context.createSession = (session, options) => ({ activate() { activated++; options.onChange({ session, connection: 'connected', canInput: true }); },
    async pasteText(text, { submit }) { pasted = [text, submit]; return { ok: true }; }, sendKey: key => { keys.push(key); return keyResult; }, snapshot: () => ({ canInput: true }), dispose() { disposed++; } });
  vm.runInContext(`(${installNativeTerminalView.toString()})(createSession, () => '已连接', '')`, context);
  const record = { id: 'session', title: 'Claude', runtimeSessionId: 'pty', runtimeSummary: { id: 'pty', status: 'running' }, status: 'running' };
  assert.equal(window.__cccOpenNativeTerminal(record, host), true); assert.deepEqual([surface.style.value, surface.style.priority], ['0px', 'important']); assert.equal(original.style.display, 'none'); assert.equal(activated, 1);
  const draft = created.find(node => node.tag === 'textarea'), send = created.find(node => node.className === 'send');
  const bar = created.find(node => node.className === 'bar'), titleHost = toolbar.children[0];
  assert.equal(titleHost.attributes['data-ccc-terminal-titlebar-content'], '', 'terminal title takes the native header slot');
  assert.equal(bar.parent, titleHost.shadowRoot); assert.equal(toolbar.children[1], nativeTitle, 'native header content stays for trailing actions');
  assert.equal(html.attributes['data-ccc-terminal-titlebar'], ''); assert.match(titleHost.shadowRoot.children[0].textContent, /\.launch\{pointer-events:auto\}/, 'header controls opt back into pointer events'); assert.match(head.children[0].textContent, /:has\(\[data-app-shell-titlebar-content\]\)\{display:none!important\}/);
  assert.equal(send.disabled, true, 'empty draft cannot be sent');
  draft.value = 'hello'; draft.oninput(); assert.equal(send.disabled, false); await send.onclick(); assert.deepEqual(pasted, ['hello', true]); assert.equal(draft.value, '');
  const chip = created.find(node => node.className === 'chip'), status = created.find(node => node.className === 'status');
  assert.equal(chip.textContent, 'Claude CLI'); assert.equal(status.attributes['data-tone'], 'ok');
  draft.value = 'ls'; draft.oninput(); await created.find(node => node.className === 'paste').onclick(); assert.deepEqual(pasted, ['ls', false]);
  const interrupt = created.find(node => node.textContent === '打断'); keyResult = { ok: false, message: '终端输入过快，请等待' }; interrupt.onclick();
  assert.deepEqual(keys, ['interrupt']); assert.equal(status.textContent, '终端输入过快，请等待'); assert.equal(status.attributes['data-tone'], 'bad');
  keyResult = { ok: true }; created.find(node => node.textContent === 'Ctrl+D').onclick(); assert.deepEqual(keys, ['interrupt', 'eof']); assert.equal(status.attributes['data-tone'], 'ok');
  window.__cccNativeTerminalView.update({ ...record, archived: true });
  assert.equal(disposed, 1); assert.equal(original.style.display, 'flex');
  assert.deepEqual(toolbar.children, [nativeTitle], 'native title comes back'); assert.equal(html.attributes['data-ccc-terminal-titlebar'], undefined);
  headerToolbar = null; window.__cccOpenNativeTerminal(record, host);
  const fallbackBar = created.filter(node => node.className === 'bar').at(-1), layout = created.filter(node => node.className === 'layout').at(-1);
  assert.equal(fallbackBar.parent, layout, 'without a native header the title stays inside the view'); window.__cccNativeTerminalView.dispose(); assert.deepEqual([surface.style.value, surface.style.priority], ['', '']); assert.equal(host.children.length, 1); assert.deepEqual(actions, []);
});

test('terminal glyph measurement keeps fullwidth punctuation at full width in both terminal views', async () => {
  const { readFile } = await import('node:fs/promises');
  const { NATIVE_TERMINAL_VIEW_STYLE } = await import('../src/native-terminal-view-style.mjs');
  const dashboard = await readFile(new URL('../public/styles/terminal.css', import.meta.url), 'utf8');
  assert.match(NATIVE_TERMINAL_VIEW_STYLE, /\.xterm\{text-spacing-trim:space-all\}/);
  assert.match(dashboard, /\.terminal-screen \.xterm \{[^}]*text-spacing-trim: space-all;/);
});

test('a Claude session held by another window is read-only: no start action and inputs stay disabled', () => {
  const created = []; const window = { __cccTerminalNative: { socketClass: () => class {}, async request() {} } };
  const documentRef = { documentElement: new Node('html'), head: new Node('head'), body: new Node('body'), getElementById: () => null, querySelector: () => null,
    createElement(tag) { const node = new Node(tag); created.push(node); return node; } };
  const context = vm.createContext({ window, document: documentRef, MutationObserver: class { observe() {} disconnect() {} }, requestAnimationFrame: fn => fn(), sessionStorage: { getItem() {}, setItem() {} } });
  vm.runInContext(`(${installNativeTerminalView.toString()})(() => { throw Error('no session'); }, () => '', '')`, context);
  const record = { id: 'held', title: '看板会话交互', kind: 'claude', status: 'stopped', runtimeSessionId: null, runtimeSummary: null, occupiedElsewhere: true };
  window.__cccOpenNativeTerminal(record, new Node('main'));
  const launch = created.find(node => node.className === 'launch'), status = created.find(node => node.className === 'status'), send = created.find(node => node.className === 'send');
  assert.equal(launch.hidden, true); assert.equal(status.textContent, '正在其他 Claude 窗口中运行 · 此处只读'); assert.equal(status.attributes['data-tone'], 'held'); assert.equal(send.disabled, true);
  window.__cccNativeTerminalView.update({ ...record, occupiedElsewhere: false });
  assert.equal(launch.hidden, false, 'once the other window exits the session can be started here'); assert.equal(status.textContent, '会话已停止，点击右上角启动');
  window.__cccNativeTerminalView.dispose();
});
