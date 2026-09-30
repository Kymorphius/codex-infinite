import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installNativeProjectSearch } from '../src/native-project-search.mjs';

function fixture(ready = ['checklist', 'board', 'console', 'sessions', 'priority']) {
  let moves = 0, styleReads = 0, terminalReads = 0, serializations = 0, backdrop = 'rgb(20, 20, 20)';
  const observers = [];
  class Node {
    constructor(tag = 'div') { this.tag = tag; this.children = []; this.attrs = {}; this.style = {}; this.listeners = {}; }
    append(...nodes) { for (const node of nodes) this.insertBefore(node, null); }
    insertBefore(node, before) {
      moves++; node.remove(); const index = before ? this.children.indexOf(before) : this.children.length;
      this.children.splice(index, 0, node); node.parentElement = this;
    }
    remove() { if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null; }
    get nextSibling() { const siblings = this.parentElement?.children || []; return siblings[siblings.indexOf(this) + 1] || null; }
    get previousElementSibling() { const siblings = this.parentElement?.children || []; return siblings[siblings.indexOf(this) - 1] || null; }
    setAttribute(key, value) { this.attrs[key] = value; }
    getAttribute(key) { return this.attrs[key] ?? null; }
    get attributes() { return []; }
    get isConnected() { let node = this; while (node.parentElement) node = node.parentElement; return node.tag === 'html'; }
    matches(selector) { return selector.split(',').some(value => select(value).includes(this)); }
    querySelector(selector) { return select(selector).find(node => node !== this && walk(this).includes(node)) || null; }
    closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; }
    addEventListener(type, handler) { this.listeners[type] = handler; }
    replaceChildren() { for (const child of this.children) child.parentElement = null; this.children = []; }
    focus() { this.focused = true; }
  }
  const root = new Node('html'), group = new Node(), scroller = new Node(), wrapper = new Node(), section = new Node('section');
  section.setAttribute('data-app-action-sidebar-section-heading', 'Projects'); root.append(group, scroller); scroller.append(wrapper); wrapper.append(section);
  const attributes = { checklist: 'data-ccc-general-checklist-entry', board: 'data-codex-control-console-kanban-entry', console: 'data-codex-control-console-entry',
    sessions: 'data-codex-control-console-session-entry', priority: 'data-codex-control-console-priority-entry' };
  const addActions = (parent, names) => names.map(name => { const node = new Node('button'); node.setAttribute(attributes[name], ''); parent.append(node); return node; });
  const actions = addActions(group, ready);
  const walk = node => [node, ...node.children.flatMap(walk)];
  const select = selector => {
    const match = /^(?:section)?\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);
    return match ? walk(root).filter(node => node.getAttribute(match[1]) !== null && (match[2] == null || node.getAttribute(match[1]) === match[2])) : [];
  };
  const document = { documentElement: root, querySelector: selector => select(selector)[0] || null, querySelectorAll: select,
    createElement: tag => new Node(tag), createElementNS: (_, tag) => new Node(tag) };
  const window = { __cccTerminalConversations: { records: () => { terminalReads++; return []; } } };
  const context = vm.createContext({ window, document, getComputedStyle: () => { styleReads++; return { backgroundColor: backdrop }; },
    JSON: { parse: JSON.parse, stringify: value => { serializations++; return JSON.stringify(value); } },
    localStorage: { getItem: () => null }, MutationObserver: class { constructor(callback) { this.callback = callback; observers.push(this); } observe() {} disconnect() { this.disposed = true; } }, requestAnimationFrame: callback => callback(),
    filter: (projects, query) => projects.filter(project => project.name.includes(query)) });
  const install = () => vm.runInContext(`(${installNativeProjectSearch.toString()})(filter)`, context);
  install();
  return { root, group, scroller, wrapper, section, window, walk, addActions, install, makeGroup() { const next = new Node(); root.insertBefore(next, scroller); return next; },
    actions, search: () => document.querySelector('[data-codex-control-console-project-search]'), reset() { moves = 0; styleReads = 0; terminalReads = 0; serializations = 0; }, get moves() { return moves; },
    get counts() { return { styleReads, terminalReads, serializations }; }, node: () => new Node(), setBackdrop(value) { backdrop = value; },
    emit(records) { for (const observer of observers) if (!observer.disposed) observer.callback(records); } };
}

test('search follows the complete shortcut group and settles without repeated moves', () => {
  const f = fixture(), search = f.search();
  assert.deepEqual(f.group.children, [...f.actions, search]);
  assert.equal(search.previousElementSibling, f.actions.at(-1), 'priority is the shortcut tail');
  assert.deepEqual(f.scroller.children, [f.wrapper], 'project list remains in its own scrolling section');
  f.reset(); for (let index = 0; index < 5; index++) f.window.__codexControlConsoleProjectSearch.refresh();
  assert.equal(f.moves, 0, 'settled shortcut placement never triggers a child-list reorder');
});

test('incomplete shortcut installation uses the last ready action and later migrates after priority', () => {
  for (const ready of [['checklist'], ['checklist', 'board'], ['board', 'console'], ['checklist', 'board', 'console', 'sessions']]) {
    const f = fixture(ready), search = f.search(); assert.equal(search.previousElementSibling, f.actions.at(-1));
    const [priority] = f.addActions(f.group, ['priority']); f.window.__codexControlConsoleProjectSearch.refresh();
    assert.equal(search.previousElementSibling, priority);
    f.reset(); f.window.__codexControlConsoleProjectSearch.refresh(); assert.equal(f.moves, 0);
  }
});

test('layouts without shortcut actions retain placement before the project section', () => {
  const f = fixture([]); assert.deepEqual(f.scroller.children, [f.search(), f.wrapper]);
  f.reset(); f.window.__codexControlConsoleProjectSearch.refresh(); assert.equal(f.moves, 0);
});

test('sidebar remount preserves the same search input, query, expanded result and floating results', () => {
  const f = fixture(), project = { id: 'p', searchKey: 'p', name: 'alpha', device: { kind: 'local-codex', name: '本机' }, tasks: [] };
  f.window.__codexControlConsoleProjectSearch.set({ projects: [project], stale: false });
  const search = f.search(), input = search.children[0].children[0], results = search.children[1];
  input.value = 'alpha'; input.listeners.input();
  f.walk(results).find(node => node.attrs['data-project-search-id'] === 'p').listeners.click();
  assert.equal(f.window.__codexControlConsoleProjectSearch.getState().expanded[0], 'p');
  f.group.remove(); const next = f.makeGroup(), actions = f.addActions(next, ['checklist', 'board', 'console', 'sessions', 'priority']);
  f.window.__codexControlConsoleProjectSearch.refresh();
  assert.equal(f.search(), search); assert.equal(search.previousElementSibling, actions.at(-1)); assert.equal(search.children[0].children[0], input);
  assert.equal(input.value, 'alpha'); assert.equal(f.window.__codexControlConsoleProjectSearch.getState().expanded[0], 'p');
  assert.equal(results.style.position, 'absolute'); assert.equal(results.style.overflowY, 'auto'); assert.equal(results.style.display, '');
  assert.equal(f.walk(results).find(node => node.attrs['data-project-search-id'] === 'p').attrs['aria-expanded'], 'true');
  f.reset(); f.window.__codexControlConsoleProjectSearch.refresh(); assert.equal(f.moves, 0);
});

test('installer refresh keeps query and expansion while Escape still clears the search', () => {
  const f = fixture(), project = { id: 'p', name: 'alpha', device: { kind: 'local-codex', name: '本机' }, tasks: [] };
  f.window.__codexControlConsoleProjectSearch.set({ projects: [project], stale: false });
  const old = f.search(), input = old.children[0].children[0]; input.value = 'alpha'; input.listeners.input();
  f.walk(old).find(node => node.attrs['data-project-search-id'] === 'p').listeners.click();
  f.window.__codexControlConsoleProjectSearch.version = 'old'; f.install();
  const replacement = f.search(), nextInput = replacement.children[0].children[0];
  assert.notEqual(replacement, old); assert.equal(nextInput.value, 'alpha'); assert.equal(f.window.__codexControlConsoleProjectSearch.getState().expanded[0], 'p');
  let stopped = 0; nextInput.listeners.keydown({ key: 'Escape', stopPropagation() { stopped++; } });
  assert.equal(stopped, 1); assert.equal(nextInput.value, ''); assert.equal(f.window.__codexControlConsoleProjectSearch.getState().expanded.length, 0);
});

test('closed search ignores unrelated streaming batches and does no catalog or style work', () => {
  const f = fixture(), timeline = f.node(), text = f.node(); f.root.append(timeline); timeline.append(text);
  f.window.__codexControlConsoleProjectSearch.set({ projects: [{ id: 'p', name: 'alpha' }], stale: false }); f.reset();
  for (let index = 0; index < 500; index++) f.emit([{ type: 'childList', target: timeline, addedNodes: [text], removedNodes: [] }]);
  for (let index = 0; index < 5; index++) f.window.__codexControlConsoleProjectSearch.refresh();
  assert.deepEqual(f.counts, { styleReads: 0, terminalReads: 0, serializations: 0 }); assert.equal(f.moves, 0);
});

test('open search caches backdrop across settled refreshes and repaints when theme changes', () => {
  const f = fixture(), search = f.search(), input = search.children[0].children[0], results = search.children[1];
  input.value = 'alpha'; input.listeners.input(); assert.equal(f.counts.styleReads, 1); f.reset();
  for (let index = 0; index < 5; index++) f.window.__codexControlConsoleProjectSearch.refresh();
  assert.equal(f.counts.styleReads, 0); assert.equal(f.moves, 0);
  f.setBackdrop('rgb(220, 220, 220)'); f.emit([{ type: 'attributes', target: f.root, attributeName: 'class' }]);
  assert.equal(f.counts.styleReads, 1); assert.match(results.style.backgroundColor, /220, 220, 220/);
  input.value = ''; input.listeners.input(); f.reset();
  f.emit([{ type: 'attributes', target: f.root, attributeName: 'class' }]);
  assert.deepEqual(f.counts, { styleReads: 0, terminalReads: 0, serializations: 0 });
  input.value = 'alpha'; input.listeners.input(); assert.equal(f.counts.styleReads, 1);
});

test('sidebar child-list remount repairs placement while preserving open search state', () => {
  const f = fixture(), search = f.search(), input = search.children[0].children[0]; input.value = 'alpha'; input.listeners.input();
  const old = f.group; old.remove(); const next = f.makeGroup(), actions = f.addActions(next, ['checklist', 'board', 'console', 'sessions', 'priority']); f.reset();
  f.emit([{ type: 'childList', target: f.root, addedNodes: [next], removedNodes: [old] }]);
  assert.equal(f.search(), search); assert.equal(search.previousElementSibling, actions.at(-1)); assert.equal(input.value, 'alpha'); assert.equal(f.counts.styleReads, 1);
  f.reset(); f.emit([{ type: 'childList', target: search.children[1], addedNodes: [], removedNodes: [] }]);
  assert.deepEqual(f.counts, { styleReads: 0, terminalReads: 0, serializations: 0 }); assert.equal(f.moves, 0);
});
