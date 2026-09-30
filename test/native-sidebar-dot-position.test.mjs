import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { positionNativeSidebarDot } from '../src/native-sidebar-dot-position.mjs';
import { installNativeSidebarModuleEntries } from '../src/native-sidebar-module-entries.mjs';

function fixture() {
  let moves = 0;
  class Node {
    constructor(tag = 'button') { this.tagName = tag; this.children = []; this.attributes = {}; this.style = {}; this.listeners = {}; this.isConnected = true; }
    getAttribute(name) { return this.attributes[name] ?? null; }
    hasAttribute(name) { return name in this.attributes; }
    setAttribute(name, value) { this.attributes[name] = value; }
    append(...nodes) { for (const node of nodes) this.insertBefore(node, null); }
    insertBefore(node, before) {
      moves++;
      if (node.parentElement) node.parentElement.children.splice(node.parentElement.children.indexOf(node), 1);
      const index = before ? this.children.indexOf(before) : this.children.length;
      this.children.splice(index, 0, node); node.parentElement = this;
    }
    get previousElementSibling() { const siblings = this.parentElement?.children || []; return siblings[siblings.indexOf(this) - 1] || null; }
    get nextSibling() { const siblings = this.parentElement?.children || []; return siblings[siblings.indexOf(this) + 1] || null; }
    addEventListener(type, handler) { this.listeners[type] = handler; }
  }
  const root = new Node('body'), group = new Node('div'), rail = new Node('nav');
  rail.setAttribute('data-app-navigation-rail', ''); root.append(rail, group);
  const walk = node => [node, ...node.children.flatMap(walk)];
  const documentRef = { createElement: tag => new Node(tag), querySelectorAll(selector) {
    const matches = selector.split(',').map(value => /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(value));
    return walk(root).filter(node => matches.some(match => node.hasAttribute(match[1]) && (match[2] == null || node.getAttribute(match[1]) === match[2])));
  }, querySelector(selector) { return this.querySelectorAll(selector)[0] || null; } };
  const add = (parent, attributes = {}) => { const node = new Node(); for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value); parent.append(node); return node; };
  const newChat = add(group, { 'aria-label': '新聊天' });
  const butler = add(group, { 'data-codex-control-console-butler-entry': '' });
  const openProject = add(group, { 'data-codex-control-console-open-local-project': '' });
  const tail = add(group, { 'data-enhanced-actions': '' });
  const dot = add(group, { 'data-sidebar-destination': 'builtin:orbit', 'aria-pressed': 'true', 'data-unread': 'true' });
  dot.textContent = 'Alfred'; dot.append(new Node('avatar'));
  return { documentRef, root, group, rail, newChat, dot, butler, openProject, tail, add, reset() { moves = 0; }, get moves() { return moves; } };
}

test('native dot moves to the Butler position with identity, state, children and handlers preserved', () => {
  const f = fixture(), events = [];
  f.dot.addEventListener('click', () => events.push('open'));
  f.dot.addEventListener('contextmenu', () => events.push('menu'));
  const attributes = { ...f.dot.attributes }, avatar = f.dot.children[0];
  f.reset(); assert.equal(positionNativeSidebarDot(f.documentRef, f.newChat), f.dot);
  assert.deepEqual(f.group.children, [f.newChat, f.dot, f.butler, f.openProject, f.tail]);
  assert.deepEqual(f.dot.attributes, attributes); assert.equal(f.dot.children[0], avatar); assert.equal(f.dot.textContent, 'Alfred');
  f.dot.listeners.click(); f.dot.listeners.contextmenu(); assert.deepEqual(events, ['open', 'menu']);
  assert.equal(f.moves, 1);
  f.reset(); for (let index = 0; index < 5; index++) positionNativeSidebarDot(f.documentRef, f.newChat);
  assert.equal(f.moves, 0, 'settled order cannot wake the mutation observers');
});

function wrappedFixture() {
  const f = fixture();
  // Native G0o -> PHr/wV has sibling a0o(New chat + our rows) and I0o(dot).
  f.group.className = 'group/nav-list flex flex-col gap-px'; f.group.setAttribute('data-appearance', 'plain');
  const wrapper = f.add(f.group); wrapper.className = 'min-w-0 flex-1';
  f.group.insertBefore(wrapper, f.newChat);
  const checklist = f.add(f.group, { 'data-ccc-general-checklist-entry': '' });
  f.tail.setAttribute('data-codex-control-console-kanban-entry', '');
  const consoleEntry = f.add(f.group, { 'data-codex-control-console-entry': '' });
  const sessions = f.add(f.group, { 'data-codex-control-console-session-entry': '' });
  const priority = f.add(f.group, { 'data-codex-control-console-priority-entry': '' });
  const search = f.add(f.group, { 'data-codex-control-console-project-search': '' });
  for (const node of [f.newChat, f.butler, f.openProject, checklist, f.tail, consoleEntry, sessions, priority, search]) wrapper.append(node);
  return { ...f, wrapper, checklist, consoleEntry, sessions, priority, search, get moves() { return f.moves; } };
}

test('latest native New chat wrapper promotes enhanced rows without reparenting native controls', () => {
  const f = wrappedFixture(), events = [], dotParent = f.dot.parentElement, chatParent = f.newChat.parentElement;
  f.dot.addEventListener('click', () => events.push('open'));
  f.dot.addEventListener('contextmenu', () => events.push('menu'));
  const attributes = { ...f.dot.attributes }, avatar = f.dot.children[0];
  f.reset(); assert.equal(positionNativeSidebarDot(f.documentRef, f.newChat), f.dot);
  assert.deepEqual(f.group.children, [f.wrapper, f.dot, f.butler, f.openProject, f.checklist, f.tail, f.consoleEntry, f.sessions, f.priority, f.search]);
  assert.deepEqual(f.wrapper.children, [f.newChat]);
  assert.equal(f.dot.parentElement, dotParent); assert.equal(f.newChat.parentElement, chatParent);
  assert.deepEqual(f.dot.attributes, attributes); assert.equal(f.dot.children[0], avatar);
  f.dot.listeners.click(); f.dot.listeners.contextmenu(); assert.deepEqual(events, ['open', 'menu']);
  assert.equal(f.moves, 8);
  const definitions = [
    { attribute: 'data-codex-control-console-kanban-entry', text: '看板', module: 'board' },
    { attribute: 'data-codex-control-console-entry', text: '控制台', module: 'console' },
    { attribute: 'data-codex-control-console-session-entry', text: '会话中心', module: 'sessions' },
    { attribute: 'data-codex-control-console-priority-entry', text: '项目优先级', module: 'priority' }
  ];
  f.newChat.className = 'native-new-chat-style'; f.dot.className = 'native-dot-selected-style';
  installNativeSidebarModuleEntries(f.documentRef, f.newChat, definitions, {}, () => {}, f.dot);
  assert.equal(f.consoleEntry.className, f.newChat.className, 'dot placement does not copy its selected styling onto module buttons');
  f.reset();
  for (let index = 0; index < 5; index++) {
    const anchor = positionNativeSidebarDot(f.documentRef, f.newChat);
    installNativeSidebarModuleEntries(f.documentRef, f.newChat, definitions, {}, () => {}, anchor);
    // Butler and Checklist place() follow OpenProject.parentElement after promotion.
    assert.equal(f.openProject.previousElementSibling, f.butler);
    assert.equal(f.checklist.previousElementSibling, f.openProject);
  }
  assert.equal(f.moves, 0, 'settled installers must not bounce rows between native wrappers');
});

test('wrapped layout defers Butler-only startup and safely promotes an incomplete shortcut group', () => {
  const f = wrappedFixture();
  f.wrapper.children.splice(f.wrapper.children.indexOf(f.openProject), 1); f.openProject.parentElement = null;
  f.reset(); assert.equal(positionNativeSidebarDot(f.documentRef, f.newChat), null); assert.equal(f.moves, 0);
  f.wrapper.insertBefore(f.openProject, f.butler.nextSibling);
  for (const node of [f.tail, f.consoleEntry, f.sessions, f.priority, f.search]) {
    f.wrapper.children.splice(f.wrapper.children.indexOf(node), 1); node.parentElement = null;
  }
  positionNativeSidebarDot(f.documentRef, f.newChat);
  assert.deepEqual(f.group.children, [f.wrapper, f.dot, f.butler, f.openProject, f.checklist]);
  f.reset(); positionNativeSidebarDot(f.documentRef, f.newChat); assert.equal(f.moves, 0);
});

test('wrapped layout scopes promotion to its native list and rejects an unrelated dot', () => {
  const f = wrappedFixture(), other = f.add(f.root);
  const elsewhere = f.add(other, { 'data-codex-control-console-entry': '' });
  positionNativeSidebarDot(f.documentRef, f.newChat);
  assert.equal(elsewhere.parentElement, other);
  const remount = f.add(f.root), nextChat = f.add(remount, { 'aria-label': '新聊天' });
  f.reset(); assert.equal(positionNativeSidebarDot(f.documentRef, nextChat), null); assert.equal(f.moves, 0);
});

test('serialized wrapped placement preserves nested native quick-chat and transfer controls', () => {
  const f = wrappedFixture(), controlRow = f.add(f.wrapper), quickChat = f.add(controlRow), transfer = f.add(f.wrapper);
  controlRow.insertBefore(f.newChat, quickChat);
  const context = vm.createContext({ documentRef: f.documentRef, newChat: f.newChat });
  assert.equal(vm.runInContext(`(${positionNativeSidebarDot.toString()})(documentRef, newChat)`, context), f.dot);
  assert.equal(f.newChat.parentElement, controlRow); assert.equal(controlRow.parentElement, f.wrapper);
  assert.equal(quickChat.parentElement, controlRow); assert.equal(transfer.parentElement, f.wrapper);
  assert.equal(f.dot.parentElement, f.group);
  f.reset(); positionNativeSidebarDot(f.documentRef, f.newChat); assert.equal(f.moves, 0);
  f.dot.hidden = true; f.reset(); assert.equal(positionNativeSidebarDot(f.documentRef, f.newChat), null); assert.equal(f.moves, 0);
});

test('a Butler-only fallback defers the move until its open-project anchor arrives', () => {
  const f = fixture();
  f.group.children.splice(f.group.children.indexOf(f.openProject), 1); f.openProject.parentElement = null;
  f.reset(); assert.equal(positionNativeSidebarDot(f.documentRef, f.newChat), null); assert.equal(f.moves, 0);
  assert.equal(f.butler.previousElementSibling, f.newChat);
  f.group.insertBefore(f.openProject, f.butler.nextSibling);
  positionNativeSidebarDot(f.documentRef, f.newChat);
  assert.deepEqual(f.group.children, [f.newChat, f.dot, f.butler, f.openProject, f.tail]);
  f.reset(); positionNativeSidebarDot(f.documentRef, f.newChat); assert.equal(f.moves, 0);
});

test('dot stays in its original native parent and rail destinations are never adopted', () => {
  const f = fixture(), other = f.add(f.root); other.insertBefore(f.dot, null);
  f.add(f.rail, { 'data-sidebar-destination': 'builtin:orbit' });
  f.reset(); assert.equal(positionNativeSidebarDot(f.documentRef, f.newChat), null); assert.equal(f.moves, 0);
  assert.equal(f.dot.parentElement, other);
  const nested = f.add(f.group); nested.insertBefore(f.dot, null);
  f.reset(); assert.equal(positionNativeSidebarDot(f.documentRef, f.newChat), null); assert.equal(f.moves, 0);
});

test('hidden, inert, disconnected, rail and non-New-chat anchors do not move dot', () => {
  for (const change of [f => { f.dot.hidden = true; }, f => f.group.setAttribute('inert', ''), f => f.group.setAttribute('aria-hidden', 'true'),
    f => { f.group.style.display = 'none'; }, f => { f.newChat.isConnected = false; }, f => f.group.setAttribute('data-app-navigation-rail', ''),
    f => f.newChat.setAttribute('aria-label', 'Apps')]) {
    const f = fixture(); change(f); f.reset(); assert.equal(positionNativeSidebarDot(f.documentRef, f.newChat), null); assert.equal(f.moves, 0);
  }
});

test('serialized dot helper has no outer dependencies and finds a replacement dot after remount', () => {
  const f = fixture(), context = vm.createContext({ documentRef: f.documentRef, newChat: f.newChat });
  assert.equal(vm.runInContext(`(${positionNativeSidebarDot.toString()})(documentRef, newChat)`, context), f.dot);
  const nextGroup = f.add(f.root), nextChat = f.add(nextGroup, { 'aria-label': 'New chat' });
  f.add(nextGroup, { 'data-enhanced-actions': '' }); const nextDot = f.add(nextGroup, { 'data-sidebar-destination': 'builtin:orbit' });
  assert.equal(positionNativeSidebarDot(f.documentRef, nextChat), nextDot); assert.equal(nextDot.previousElementSibling, nextChat);
  assert.equal(f.dot.parentElement, f.group, 'a remount does not steal a dot from the former parent');
});
