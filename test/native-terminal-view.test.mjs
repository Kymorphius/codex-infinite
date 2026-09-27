import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installNativeTerminalView } from '../src/native-terminal-view.mjs';
class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.style = {}; this.value = ''; }
  setAttribute() {} addEventListener() {}
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
  replaceChildren() { this.children = []; }
  attachShadow() { this.shadowRoot = new Node('shadow'); return this.shadowRoot; }
}
test('native conversation mounts full terminal and composer, preserves draft, and restores host without stopping PTY', async () => {
  const host = new Node('main'), original = new Node('conversation'); original.style.display = 'flex'; host.append(original);
  const created = [], actions = []; let disposed = 0, activated = 0, pasted;
  const window = { __cccTerminalNative: { socketClass: () => class {}, async request(operation) { actions.push(operation); } } };
  const drafts = new Map();
  const context = vm.createContext({ window, document: { createElement(tag) { const node = new Node(tag); created.push(node); return node; } },
    sessionStorage: { getItem: key => drafts.get(key), setItem: (key, value) => drafts.set(key, value) } });
  context.createSession = (session, options) => ({ activate() { activated++; options.onChange({ session, connection: 'connected', canInput: true }); },
    async pasteText(text) { pasted = text; return { ok: true }; }, sendKey: () => ({ ok: true }), snapshot: () => ({ canInput: true }), dispose() { disposed++; } });
  vm.runInContext(`(${installNativeTerminalView.toString()})(createSession, () => '已连接', '')`, context);
  const record = { id: 'session', title: 'Claude', runtimeSessionId: 'pty', runtimeSummary: { id: 'pty', status: 'running' }, status: 'running' };
  assert.equal(window.__cccOpenNativeTerminal(record, host), true); assert.equal(original.style.display, 'none'); assert.equal(activated, 1);
  const draft = created.find(node => node.tag === 'textarea'), send = created.find(node => node.className === 'send');
  draft.value = 'hello'; draft.oninput(); await send.onclick(); assert.equal(pasted, 'hello'); assert.equal(draft.value, '');
  window.__cccNativeTerminalView.update({ ...record, archived: true });
  assert.equal(disposed, 1); assert.equal(original.style.display, 'flex'); assert.equal(host.children.length, 1); assert.deepEqual(actions, []);
});
