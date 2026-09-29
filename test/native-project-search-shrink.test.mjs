import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildNativeProjectSearchInjectionScript } from '../src/native-project-search.mjs';

test('expanding a project with many sessions never lets flex shrink the project rows away', () => {
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.style = {}; this.listeners = {}; }
    append(...nodes) { for (const node of nodes) { this.children.push(node); node.parentElement = this; } }
    insertBefore(node) { this.children.unshift(node); node.parentElement = this; }
    remove() {} setAttribute(k, v) { this.attrs[k] = v; } getAttribute(k) { return this.attrs[k] ?? null; }
    get attributes() { return []; } addEventListener(k, fn) { this.listeners[k] = fn; } replaceChildren() { this.children = []; }
  }
  const parent = new Node(), wrapper = new Node(), native = new Node(); parent.append(wrapper); wrapper.append(native);
  const walk = node => [node, ...node.children.flatMap(walk)];
  const window = { __cccTerminalConversations: { records: () => [] } };
  const context = vm.createContext({ window, document: { documentElement: parent, querySelector: selector => selector.startsWith('section') ? native : null,
    querySelectorAll: () => [], createElement: tag => new Node(tag), createElementNS: (_, tag) => new Node(tag) },
    MutationObserver: class { observe() {} disconnect() {} }, requestAnimationFrame: fn => fn() });
  vm.runInContext(buildNativeProjectSearchInjectionScript(), context);
  const tasks = Array.from({ length: 40 }, (_, index) => ({ id: `t${index}`, title: `会话 ${index}`, updatedAt: '2026-09-29T10:00:00Z', status: 'completed' }));
  window.__codexControlConsoleProjectSearch.set({ stale: false, projects: [{ id: 'p', searchKey: 'local', name: '看板', sourceDirectories: ['/work/app'],
    device: { kind: 'local-codex', name: '本机', status: 'connected' }, tasks }] });
  const input = walk(parent).find(node => node.tag === 'input'); input.value = '看板'; input.listeners.input();
  const project = walk(parent).find(node => node.attrs['data-project-search-id'] === 'local');
  project.listeners.click();
  const results = project.parentElement;
  assert.ok(results.children.length > 10);
  assert.ok(results.children.every(child => child.style.flexShrink === '0'), 'every result row keeps its own height');
});
