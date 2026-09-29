import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { terminalProjectConversations } from '../src/project-search.mjs';
import { buildNativeProjectSearchInjectionScript } from '../src/native-project-search.mjs';

const ref = { source: 'codex', key: 'codex:project:sidebar-id', id: 'sidebar-id', hostId: 'local' };
const terminal = (id, extra = {}) => ({ id, provider: 'terminal', deviceId: 'mac', title: 'Claude CLI', cwd: '/work/app', kind: 'claude', status: 'running', archived: false, projectRef: ref, updatedAt: '2026-09-27T10:00:00Z', ...extra });

test('terminal conversations join local projects by verified cwd, never remote or archived ones', () => {
  const records = [terminal('a'), terminal('b', { updatedAt: '2026-09-27T12:00:00Z', kind: 'shell' }), terminal('archived', { archived: true }),
    terminal('other', { cwd: '/work/other' }), terminal('loose', { projectRef: null }), { ...terminal('codex'), provider: 'codex' }];
  const local = { id: 'server-id', sourceDirectories: ['/work/app'], device: { kind: 'local-codex' } };
  assert.deepEqual(terminalProjectConversations(local, records).map(record => record.id), ['b', 'a']);
  assert.deepEqual(terminalProjectConversations({ ...local, device: { kind: 'remote-codex' } }, records), []);
  assert.deepEqual(terminalProjectConversations({ id: 'x' }, records), []);
  assert.deepEqual(terminalProjectConversations(local, null), []);
});

test('project search lists terminal rows with a provider tag under the expanded local project and opens them', () => {
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.style = {}; this.listeners = {}; }
    append(...nodes) { for (const node of nodes) { this.children.push(node); node.parentElement = this; } }
    insertBefore(node) { this.children.unshift(node); node.parentElement = this; }
    remove() {} setAttribute(k, v) { this.attrs[k] = v; } getAttribute(k) { return this.attrs[k] ?? null; }
    get attributes() { return []; } addEventListener(k, fn) { this.listeners[k] = fn; } replaceChildren() { this.children = []; }
  }
  const parent = new Node(), wrapper = new Node(), native = new Node(); parent.append(wrapper); wrapper.append(native);
  const walk = node => [node, ...node.children.flatMap(walk)];
  const opened = [];
  let records = [terminal('a')];
  const window = { __cccTerminalConversations: { records: () => records }, __codexControlConsoleOpenTerminalConversation: record => opened.push(record.id) };
  const context = vm.createContext({ window, document: { documentElement: parent, querySelector: selector => selector.startsWith('section') ? native : null,
    querySelectorAll: () => [], createElement: tag => new Node(tag), createElementNS: (_, tag) => new Node(tag) },
    MutationObserver: class { observe() {} disconnect() {} }, requestAnimationFrame: fn => fn() });
  vm.runInContext(buildNativeProjectSearchInjectionScript(), context);
  window.__codexControlConsoleProjectSearch.set({ stale: false, projects: [{ id: 'server-id', searchKey: 'local', name: '看板', sourceDirectories: ['/work/app'],
    device: { kind: 'local-codex', name: '本机', status: 'connected' }, tasks: [] }] });
  const input = walk(parent).find(node => node.tag === 'input'); input.value = '看板'; input.listeners.input();
  walk(parent).find(node => node.attrs['data-project-search-id'] === 'local').listeners.click();
  const row = () => walk(parent).find(node => node.attrs['data-project-search-terminal-id'] === 'a');
  assert.ok(row()); assert.ok(!walk(parent).some(node => node.textContent === '暂无未归档会话'));
  const tag = walk(row()).find(node => node.attrs['data-terminal-engine']);
  assert.equal(tag.textContent, 'CLI'); assert.equal(tag.attrs['data-running'], 'true');
  // Same shape as the sidebar: the title fills the row, so the tag sits at the trailing edge.
  assert.equal(tag.parentElement.children.at(-1), tag); assert.match(tag.parentElement.children[1].className, /\bflex-1\b/);
  row().listeners.click(); assert.deepEqual(opened, ['a']);
  records = [terminal('a', { archived: true })]; window.__codexControlConsoleProjectSearch.refresh();
  assert.equal(row(), undefined); assert.ok(walk(parent).some(node => node.textContent === '暂无未归档会话'));
});

test('Claude marks in search results share the sidebar contrast rule', async () => {
  const { createNativeTerminalSidebar } = await import('../src/native-terminal-sidebar.mjs');
  const head = { appended: [], append(node) { this.appended.push(node); } };
  createNativeTerminalSidebar({ documentRef: { head, createElement: () => ({ dataset: {}, style: {} }) }, readModel: () => ({ sections: [] }), open() {}, menu() {} });
  assert.match(head.appended[0].textContent, /:is\(\[data-ccc-terminal-sidebar-row\],\[data-project-search-terminal-id\]\):has\(\[data-terminal-engine="claude"\]\) \[data-terminal-glyph\]\{color:#f2bd5c/);
});


test('a Codex task with a companion gets the collapsed disclosure and the ↳ row in search results', () => {
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.style = {}; this.listeners = {}; }
    append(...nodes) { for (const node of nodes) { this.children.push(node); node.parentElement = this; } }
    insertBefore(node) { this.children.unshift(node); node.parentElement = this; }
    remove() {} setAttribute(k, v) { this.attrs[k] = v; } getAttribute(k) { return this.attrs[k] ?? null; }
    get attributes() { return []; } addEventListener(k, fn) { this.listeners[k] = fn; } replaceChildren() { this.children = []; }
  }
  const parent = new Node(), wrapper = new Node(), native = new Node(); parent.append(wrapper); wrapper.append(native);
  const walk = node => [node, ...node.children.flatMap(walk)];
  const thread = '01a0be7e-3c97-76a3-b5da-36c782facc71', stored = { value: null };
  const companion = { ...terminal('c1', { projectRef: null, cwd: '/work/app' }), title: '增加 codex-router 项目', companionOf: thread };
  const window = { __cccTerminalConversations: { records: () => [companion] }, __codexControlConsoleOpenTerminalConversation() {} };
  const context = vm.createContext({ window, document: { documentElement: parent, querySelector: selector => selector.startsWith('section') ? native : null,
    querySelectorAll: () => [], createElement: tag => new Node(tag), createElementNS: (_, tag) => new Node(tag) },
    localStorage: { getItem: () => stored.value, setItem: (key, value) => { stored.value = value; } },
    MutationObserver: class { observe() {} disconnect() {} }, requestAnimationFrame: fn => fn() });
  vm.runInContext(buildNativeProjectSearchInjectionScript(), context);
  window.__codexControlConsoleProjectSearch.set({ stale: false, projects: [{ id: 'server-id', searchKey: 'local', name: '看板', sourceDirectories: ['/elsewhere'],
    device: { kind: 'local-codex', name: '本机', status: 'connected' }, tasks: [{ id: thread, title: '增加 codex-router 项目' }] }] });
  const input = walk(parent).find(node => node.tag === 'input'); input.value = '看板'; input.listeners.input();
  walk(parent).find(node => node.attrs['data-project-search-id'] === 'local').listeners.click();
  const holder = () => walk(parent).find(node => node.attrs['data-project-search-companion-thread'] === thread);
  const toggle = () => holder().children.find(node => node.attrs['data-companion-toggle'] === '');
  const row = () => walk(parent).find(node => node.attrs['data-companion'] === 'true');
  assert.equal(toggle().attrs['aria-expanded'], 'false'); assert.equal(row(), undefined, 'collapsed by default');
  toggle().listeners.click({ preventDefault() {}, stopPropagation() {} });
  assert.equal(stored.value, JSON.stringify([thread]), 'shares the sidebar preference');
  assert.equal(toggle().attrs['aria-expanded'], 'true'); assert.ok(row());
  assert.equal(walk(row()).find(node => node.attrs['data-terminal-glyph'] === '').textContent, '↳');
  assert.equal(walk(parent).filter(node => node.attrs['data-project-search-terminal-id'] === 'c1').length, 1, 'listed once, under its task');
});

test('project search mounts in the fixed slot under the board entry and floats results in their own scroller', () => {
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.style = {}; this.listeners = {}; this.parentElement = null; }
    append(...nodes) { for (const node of nodes) { node.remove(); this.children.push(node); node.parentElement = this; } }
    insertBefore(node, before) { node.remove(); const at = before ? this.children.indexOf(before) : -1; this.children.splice(at < 0 ? this.children.length : at, 0, node); node.parentElement = this; }
    remove() { if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null; }
    get nextSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1] || null; }
    get previousElementSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) - 1] || null; }
    setAttribute(k, v) { this.attrs[k] = v; } getAttribute(k) { return this.attrs[k] ?? null; }
    get attributes() { return []; } addEventListener(k, fn) { this.listeners[k] = fn; } replaceChildren() { this.children = []; }
  }
  const nav = new Node('nav'), checklist = new Node('button'), board = new Node('button'), scroller = new Node('div'), section = new Node('section');
  nav.append(checklist, board); scroller.append(section);
  const walk = node => [node, ...node.children.flatMap(walk)];
  const window = { __cccTerminalConversations: { records: () => [] } };
  const pick = { '[data-ccc-general-checklist-entry]': checklist, '[data-codex-control-console-kanban-entry]': board };
  const context = vm.createContext({ window, getComputedStyle: () => ({ backgroundColor: 'rgb(20, 20, 20)' }),
    document: { documentElement: new Node('html'), querySelector: selector => pick[selector] || (selector.startsWith('section') ? section : null),
      querySelectorAll: () => [], createElement: tag => new Node(tag), createElementNS: (_, tag) => new Node(tag) },
    MutationObserver: class { observe() {} disconnect() {} }, requestAnimationFrame: fn => fn() });
  vm.runInContext(buildNativeProjectSearchInjectionScript(), context);
  assert.equal(nav.children[2].attrs['data-codex-control-console-project-search'], '');
  assert.equal(scroller.children.length, 1, 'nothing is inserted into the scrolling list');
  const results = nav.children[2].children[1];
  assert.equal(results.style.display, 'none');
  window.__codexControlConsoleProjectSearch.set({ stale: false, projects: [{ id: 'p', searchKey: 'p', name: 'alpha', sourceDirectories: [], device: { kind: 'local-codex', name: '本机', status: 'connected' }, tasks: [] }] });
  const input = walk(nav).find(node => node.tag === 'input'); input.value = 'alpha'; input.listeners.input();
  assert.equal(results.style.position, 'absolute');
  assert.equal(results.style.overflowY, 'auto');
  assert.equal(results.style.display, '');
});
