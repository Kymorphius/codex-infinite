import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildNativeGeneralChecklistScript } from '../src/native-general-checklist.mjs';
test('general entry is unique, opens inbox, remounts and disposes without touching native rows', () => {
  class Node {
    constructor() { this.children = []; this.style = {}; this.attrs = {}; this.events = {}; }
    setAttribute(k,v) { this.attrs[k] = v; }
    append(n) { n.remove(); this.children.push(n); n.parentElement = this; }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(n => n !== this); this.parentElement = null; }
    addEventListener(k,fn) { this.events[k] = fn; }
  }
  let parent = new Node(), callback, opens = 0, disconnected = false;
  const native = { parentElement: { get parentElement() { return parent; } } };
  const context = vm.createContext({ window: { __cccProjectChecklist: { openGeneral() { opens++; } } }, document: { createElement: () => new Node(), querySelector: () => native, documentElement: {} }, requestAnimationFrame: fn => fn(), MutationObserver: class { constructor(fn) { callback = fn; } observe() {} disconnect() { disconnected = true; } } });
  const script = buildNativeGeneralChecklistScript(); vm.runInContext(script, context); vm.runInContext(script, context);
  assert.equal(parent.children.length, 1); const root = parent.children[0]; root.children[0].events.click(); assert.equal(opens, 1);
  const old = parent; parent = new Node(); callback(); assert.equal(old.children.length, 0); assert.equal(parent.children[0], root);
  context.window.__cccGeneralChecklist.dispose(); assert.equal(parent.children.length, 0); assert.equal(disconnected, true);
});
