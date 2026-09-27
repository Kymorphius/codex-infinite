import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installNativeTerminalView } from '../src/native-terminal-view.mjs';
class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.style = {}; this.value = ''; this.attributes = {}; }
  setAttribute(name, value) { this.attributes[name] = value; } addEventListener() {}
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
  replaceChildren() { this.children = []; }
  attachShadow() { this.shadowRoot = new Node('shadow'); return this.shadowRoot; }
}
test('native conversation mounts full terminal and composer, preserves draft, and restores host without stopping PTY', async () => {
  const surface = { style: { value: '', priority: '', getPropertyValue() { return this.value; }, getPropertyPriority() { return this.priority; }, setProperty(name, value, priority) { this.value = value; this.priority = priority; } } };
  const host = new Node('main'), original = new Node('conversation'); original.style.display = 'flex'; host.append(original); host.closest = selector => selector.includes('_MainContentSurface_') ? surface : null;
  const created = [], actions = [], keys = []; let disposed = 0, activated = 0, pasted, keyResult;
  const window = { __cccTerminalNative: { socketClass: () => class {}, async request(operation) { actions.push(operation); } } };
  const drafts = new Map();
  const context = vm.createContext({ window, document: { createElement(tag) { const node = new Node(tag); created.push(node); return node; } },
    sessionStorage: { getItem: key => drafts.get(key), setItem: (key, value) => drafts.set(key, value) } });
  context.createSession = (session, options) => ({ activate() { activated++; options.onChange({ session, connection: 'connected', canInput: true }); },
    async pasteText(text, { submit }) { pasted = [text, submit]; return { ok: true }; }, sendKey: key => { keys.push(key); return keyResult; }, snapshot: () => ({ canInput: true }), dispose() { disposed++; } });
  vm.runInContext(`(${installNativeTerminalView.toString()})(createSession, () => '已连接', '')`, context);
  const record = { id: 'session', title: 'Claude', runtimeSessionId: 'pty', runtimeSummary: { id: 'pty', status: 'running' }, status: 'running' };
  assert.equal(window.__cccOpenNativeTerminal(record, host), true); assert.deepEqual([surface.style.value, surface.style.priority], ['0px', 'important']); assert.equal(original.style.display, 'none'); assert.equal(activated, 1);
  const draft = created.find(node => node.tag === 'textarea'), send = created.find(node => node.className === 'send');
  assert.equal(send.disabled, true, 'empty draft cannot be sent');
  draft.value = 'hello'; draft.oninput(); assert.equal(send.disabled, false); await send.onclick(); assert.deepEqual(pasted, ['hello', true]); assert.equal(draft.value, '');
  const chip = created.find(node => node.className === 'chip'), status = created.find(node => node.className === 'status');
  assert.equal(chip.textContent, 'Claude CLI'); assert.equal(status.attributes['data-tone'], 'ok');
  draft.value = 'ls'; draft.oninput(); await created.find(node => node.className === 'paste').onclick(); assert.deepEqual(pasted, ['ls', false]);
  const interrupt = created.find(node => node.textContent === '打断'); keyResult = { ok: false, message: '终端输入过快，请等待' }; interrupt.onclick();
  assert.deepEqual(keys, ['interrupt']); assert.equal(status.textContent, '终端输入过快，请等待'); assert.equal(status.attributes['data-tone'], 'bad');
  keyResult = { ok: true }; created.find(node => node.textContent === 'Ctrl+D').onclick(); assert.deepEqual(keys, ['interrupt', 'eof']); assert.equal(status.attributes['data-tone'], 'ok');
  window.__cccNativeTerminalView.update({ ...record, archived: true });
  assert.equal(disposed, 1); assert.equal(original.style.display, 'flex'); assert.deepEqual([surface.style.value, surface.style.priority], ['', '']); assert.equal(host.children.length, 1); assert.deepEqual(actions, []);
});
