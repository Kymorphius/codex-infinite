import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installNativeTerminalView } from '../src/native-terminal-view.mjs';
class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.style = {}; this.value = ''; this.attributes = {}; }
  setAttribute(name, value) { this.attributes[name] = value; } addEventListener() {}
  get parentNode() { return this.parent || null; }
  removeAttribute(name) { delete this.attributes[name]; }
  hasAttribute(name) { return name in this.attributes; } toggleAttribute(name, on) { if (on) this.attributes[name] = ''; else delete this.attributes[name]; }
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

test('a Claude session held by another window is read-only, offers a two-step takeover, and keeps the key menu shut', async () => {
  const created = [], requests = [];
  const window = { __cccTerminalNative: { socketClass: () => class {}, async request(operation, input) { requests.push([operation, input]); throw Error('接管失败'); } } };
  const documentRef = { documentElement: new Node('html'), head: new Node('head'), body: new Node('body'), getElementById: () => null, querySelector: () => null,
    createElement(tag) { const node = new Node(tag); created.push(node); return node; } };
  const timers = [];
  const context = vm.createContext({ window, document: documentRef, MutationObserver: class { observe() {} disconnect() {} }, requestAnimationFrame: fn => fn(), sessionStorage: { getItem() {}, setItem() {} },
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout: () => {} });
  vm.runInContext(`(${installNativeTerminalView.toString()})(() => { throw Error('no session'); }, () => '', '')`, context);
  const record = { id: 'held', title: '看板会话交互', kind: 'claude', status: 'stopped', runtimeSessionId: null, runtimeSummary: null, occupiedElsewhere: true };
  window.__cccOpenNativeTerminal(record, new Node('main'));
  const find = name => created.find(node => node.className === name);
  const launch = find('launch'), status = find('status'), send = find('send'), keys = find('keys'), more = keys.children[0];
  assert.equal(launch.hidden, false); assert.equal(launch.textContent, '强制接管');
  assert.equal(status.textContent, '正在其他 Claude 窗口中运行 · 此处只读'); assert.equal(status.attributes['data-tone'], 'held'); assert.equal(send.disabled, true);
  assert.equal(more.tabIndex, -1); assert.equal(more.attributes['aria-disabled'], 'true');
  let prevented = false; more.onclick({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true, 'keyboard activation cannot open the key menu while read-only');
  await launch.onclick();
  assert.equal(requests.length, 0, 'the first click only arms'); assert.equal(launch.textContent, '确认接管？将结束其他窗口'); assert.ok('data-armed' in launch.attributes);
  timers.at(-1)(); assert.equal(launch.textContent, '强制接管', 'the confirmation expires');
  await launch.onclick(); await launch.onclick();
  assert.equal(JSON.stringify(requests), JSON.stringify([['start', { id: 'held', takeover: true }]])); assert.equal(status.textContent, '接管失败');
  window.__cccNativeTerminalView.update({ ...record, occupiedBy: 'background' });
  assert.equal(launch.textContent, '在此打开'); assert.equal(status.textContent, '正在 Claude 后台运行 · 可在此打开');
  await launch.onclick();
  assert.equal(JSON.stringify(requests.at(-1)), JSON.stringify(['start', { id: 'held' }]), 'a background session opens in one click without takeover');
  window.__cccNativeTerminalView.update({ ...record, occupiedElsewhere: false, occupiedBy: null });
  assert.equal(launch.textContent, '启动会话', 'once the other window exits it is a normal start');
  await launch.onclick(); assert.equal(JSON.stringify(requests.at(-1)), JSON.stringify(['start', { id: 'held' }]), 'a plain start never asks to take over');
  window.__cccNativeTerminalView.dispose();
});

test('opening a conversation opens it once: resume or attach automatically, never a takeover', async () => {
  const harness = (record, fail = false) => {
    const created = [], requests = [];
    const window = { __cccTerminalNative: { socketClass: () => class {}, async request(operation, input) { requests.push(JSON.stringify([operation, input])); if (fail) throw Error('启动失败'); return { conversation: { ...record, runtimeSessionId: null } }; } } };
    const documentRef = { documentElement: new Node('html'), head: new Node('head'), body: new Node('body'), getElementById: () => null, querySelector: () => null,
      createElement(tag) { const node = new Node(tag); created.push(node); return node; } };
    const context = vm.createContext({ window, document: documentRef, MutationObserver: class { observe() {} disconnect() {} }, requestAnimationFrame: fn => fn(),
      sessionStorage: { getItem() {}, setItem() {} }, setTimeout: () => 1, clearTimeout: () => {} });
    vm.runInContext(`(${installNativeTerminalView.toString()})(() => { throw Error('no session'); }, () => '', '')`, context);
    window.__cccOpenNativeTerminal(record, new Node('main'));
    return { window, requests, launch: created.find(node => node.className === 'launch'), status: created.find(node => node.className === 'status') };
  };
  const base = { id: 'c1', title: '看板会话交互', kind: 'claude', status: 'stopped', runtimeSessionId: null, runtimeSummary: null, occupiedElsewhere: false, occupiedBy: null };
  const tick = () => new Promise(resolve => setImmediate(resolve));
  const stopped = harness(base); await tick();
  assert.deepEqual(stopped.requests, [JSON.stringify(['start', { id: 'c1' }])], 'a stopped conversation resumes on open'); assert.equal(stopped.launch.hidden, true);
  const background = harness({ ...base, occupiedElsewhere: true, occupiedBy: 'background' }); await tick();
  assert.deepEqual(background.requests, [JSON.stringify(['start', { id: 'c1' }])], 'a background session is attached on open');
  const terminal = harness({ ...base, occupiedElsewhere: true, occupiedBy: 'terminal' }); await tick();
  assert.deepEqual(terminal.requests, [], 'a takeover is never automatic'); assert.equal(terminal.launch.hidden, false); assert.equal(terminal.launch.textContent, '强制接管');
  const codex = harness({ ...base, occupiedElsewhere: true, occupiedBy: 'codex', companionOf: 't' }); await tick();
  assert.deepEqual(codex.requests, [], 'waits while Codex is replying');
  codex.window.__cccNativeTerminalView.update({ ...base, companionOf: 't' }); await tick();
  assert.deepEqual(codex.requests, [JSON.stringify(['start', { id: 'c1' }])], 'opens once the Codex turn ends');
  const failing = harness(base, true); await tick();
  assert.equal(failing.launch.hidden, false, 'the button returns for a retry'); assert.equal(failing.status.textContent, '启动失败');
  failing.window.__cccNativeTerminalView.update({ ...base, runtimeError: '启动失败' }); await tick();
  assert.equal(failing.requests.length, 1, 'no automatic retry loop');
  for (const value of [stopped, background, terminal, codex, failing]) value.window.__cccNativeTerminalView?.dispose();
});

test('a rebuilt native client is used after remount, and a session lost without an exit reopens once', async () => {
  const requests = [], sockets = [];
  const client = name => ({ socketClass: () => { sockets.push(name); return class {}; }, async request(operation, input) { requests.push(name + ':' + operation); return { conversation: { ...running, runtimeSessionId: 'r2' } }; } });
  const window = { __cccTerminalNative: client('old') };
  let onChange = null;
  const createSession = (summary, options) => { onChange = options.onChange; options.WebSocketCtor; return { dispose() {}, activate() {}, snapshot: () => ({ canInput: true }) }; };
  const documentRef = { documentElement: new Node('html'), head: new Node('head'), body: new Node('body'), getElementById: () => null, querySelector: () => null, createElement: tag => new Node(tag) };
  const context = vm.createContext({ window, document: documentRef, MutationObserver: class { observe() {} disconnect() {} }, requestAnimationFrame: fn => fn(),
    sessionStorage: { getItem() {}, setItem() {} }, setTimeout: () => 1, clearTimeout: () => {}, createSession });
  vm.runInContext(`(${installNativeTerminalView.toString()})(createSession, () => '', '')`, context);
  const running = { id: 'c1', title: '看板会话交互', kind: 'claude', status: 'running', runtimeSessionId: 'r1', runtimeSummary: { id: 'r1', status: 'running' }, occupiedBy: null };
  window.__cccOpenNativeTerminal(running, new Node('main'));
  window.__cccTerminalNative = client('new'); window.__cccNativeTerminalView.remount();
  assert.deepEqual(sockets, ['old', 'new'], 'the shown terminal reconnects through the rebuilt client');
  window.__cccNativeTerminalView.update({ ...running, status: 'stopped', runtimeSessionId: null, runtimeSummary: null, occupiedElsewhere: true, occupiedBy: 'background' });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(requests, ['new:start'], 'a backend restart that dropped the attach reopens it');
  onChange({ session: { status: 'exited' }, connection: 'closed', canInput: false });
  window.__cccNativeTerminalView.update({ ...running, status: 'stopped', runtimeSessionId: null, runtimeSummary: null });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 1, 'a session you exited here is not restarted');
  window.__cccNativeTerminalView.dispose();
});
