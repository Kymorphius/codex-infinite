import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildNativePinnedEmptyInjectionScript } from '../src/native-pinned-empty.mjs';
test('empty pinned entry uses native styles and gives way to real native pins without moving rows', () => {
  class Node {
    constructor() { this.children = []; this.attrs = {}; this.style = {}; }
    append(...nodes) { for (const node of nodes) { this.children.push(node); node.parentElement = this; } }
    insertBefore(node, before) { this.children.splice(this.children.indexOf(before), 0, node); node.parentElement = this; }
    remove() { this.parentElement?.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null; }
    setAttribute(k, v) { this.attrs[k] = v; } getAttribute(k) { return this.attrs[k]; }
    querySelector() { return { className: 'native-title', firstElementChild: { className: 'native-text' } }; }
  }
  const parent = new Node(), wrapper = new Node(), native = new Node(), pinned = new Node();
  parent.append(wrapper); wrapper.append(native); native.className = 'native-section';
  native.setAttribute('data-app-action-sidebar-section-heading', 'Projects'); pinned.setAttribute('data-app-action-sidebar-section-heading', 'Pinned');
  let sections = [native], update;
  const context = vm.createContext({ window: {}, document: { documentElement: parent, querySelectorAll: selector => selector.startsWith('section') ? sections : [], createElement: () => new Node() }, MutationObserver: class { constructor(fn) { update = fn; } observe() {} disconnect() {} }, requestAnimationFrame: fn => fn() });
  vm.runInContext(buildNativePinnedEmptyInjectionScript(), context);
  assert.equal(parent.children[0].style.order, '1'); assert.equal(parent.children.length, 2); assert.equal(parent.children[0].children[0].className, 'native-section');
  assert.equal(parent.children[0].children[0].children[0].children[0].textContent, '置顶');
  update(); assert.equal(parent.children.length, 2);
  sections = [pinned, native]; update(); assert.equal(parent.children.length, 1); assert.equal(wrapper.children[0], native);
  sections = [native]; update(); assert.equal(parent.children.length, 2);
  context.window.__codexControlConsolePinnedEmpty.dispose(); update(); assert.equal(parent.children.length, 1);
});
