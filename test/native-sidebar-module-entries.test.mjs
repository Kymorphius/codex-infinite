import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installNativeSidebarModuleEntries } from '../src/native-sidebar-module-entries.mjs';
import { NATIVE_ENTRY_ICONS } from '../src/native-entry-icons.mjs';

const definitions = [
  { attribute: 'data-board', text: '看板', module: 'board' },
  { attribute: 'data-console', text: '控制台', module: 'console' },
  { attribute: 'data-sessions', text: '会话中心', module: 'sessions' },
  { attribute: 'data-priority', text: '项目优先级', module: 'priority' }
];

function fixture() {
  let writes = 0;
  class Node {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.attributes = {}; this.children = []; this.listeners = [];
      let css = '';
      this.style = { get cssText() { return css; }, set cssText(value) { writes++; css = value.replace(/;/g, '; '); } };
    }
    getAttribute(name) { return this.attributes[name] ?? null; }
    setAttribute(name, value) { writes++; this.attributes[name] = value; }
    get className() { return this.attributes.class || ''; }
    set className(value) { this.setAttribute('class', value); }
    get innerHTML() { return this.markup || ''; }
    set innerHTML(value) {
      writes++; this.children = [];
      // Emulate the browser's paired-tag SVG serialization instead of keeping
      // the helper's self-closing SVG source unchanged.
      this.markup = value.replace(/<([a-z]+)([^>]*)\/>/g, '<$1$2></$1>');
      const stack = [this];
      for (const token of this.markup.match(/<[^>]+>|[^<]+/g) || []) {
        if (token.startsWith('</')) { stack.pop(); continue; }
        if (!token.startsWith('<')) { stack.at(-1).text = token; continue; }
        const node = new Node(token.match(/^<([^\s>]+)/)[1]);
        for (const match of token.matchAll(/([^\s=<>]+)="([^"]*)"/g)) node.attributes[match[1]] = match[2];
        stack.at(-1).children.push(node); node.parentElement = stack.at(-1); stack.push(node);
      }
    }
    get previousElementSibling() { const siblings = this.parentElement?.children || []; return siblings[siblings.indexOf(this) - 1] || null; }
    get nextSibling() { const siblings = this.parentElement?.children || []; return siblings[siblings.indexOf(this) + 1] || null; }
    insertBefore(node, before) {
      writes++;
      if (node.parentElement) node.parentElement.children.splice(node.parentElement.children.indexOf(node), 1);
      const index = before ? this.children.indexOf(before) : this.children.length;
      this.children.splice(index, 0, node); node.parentElement = this;
    }
    remove() { writes++; if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null; }
    closest(selector) {
      for (let node = this; node; node = node.parentElement) if (selector === 'nav[data-app-navigation-rail]' && node.tagName === 'NAV' && node.getAttribute('data-app-navigation-rail') !== null) return node;
      return null;
    }
    addEventListener(type, handler) { this.listeners.push({ type, handler }); }
    click() { let prevented = 0, stopped = 0; for (const { handler } of this.listeners) handler({ preventDefault() { prevented++; }, stopPropagation() { stopped++; } }); return { prevented, stopped }; }
  }
  const root = new Node('body'), rail = new Node('nav'), group = new Node('div');
  rail.setAttribute('data-app-navigation-rail', ''); root.insertBefore(rail, null); root.insertBefore(group, null);
  const all = node => [node, ...node.children.flatMap(all)];
  const documentRef = {
    createElement: tag => new Node(tag),
    querySelectorAll: selector => {
      const match = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);
      return all(root).filter(node => node.getAttribute(match[1]) !== null && (match[2] == null || node.getAttribute(match[1]) === match[2]));
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  };
  const add = (parent, attributes = {}, className = 'sidebar-item flex w-full hover:bg-primary-ghost-hover') => {
    const node = new Node('button'); for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    node.className = className; parent.insertBefore(node, null); return node;
  };
  const anchor = add(group, { 'aria-label': '新聊天' });
  return { documentRef, root, rail, group, anchor, add, get writes() { return writes; }, resetWrites() { writes = 0; } };
}

test('misplaced module entries migrate together without changing native actions or existing click routes', () => {
  const f = fixture(), routes = [];
  const railAction = f.add(f.rail, { 'aria-label': 'Apps' }, 'native-icon-rail');
  const butler = f.add(f.group, { 'data-butler': '' }), localProject = f.add(f.group, { 'data-local-project': '' });
  const checklist = f.add(f.group, { 'data-ccc-general-checklist-entry': '' });
  const following = f.add(f.group, { 'data-native-following': '' });
  const entries = definitions.map((definition, index) => {
    const entry = f.add(index ? f.rail : f.group, { [definition.attribute]: '' }, 'icon-rail-stack');
    entry.innerHTML = NATIVE_ENTRY_ICONS[definition.module] + '<span>' + definition.text + '</span>';
    entry.addEventListener('click', () => routes.push(definition.module)); return entry;
  });
  const installed = installNativeSidebarModuleEntries(f.documentRef, f.anchor, definitions, NATIVE_ENTRY_ICONS, () => assert.fail('old click route must be preserved'));
  assert.deepEqual(installed, entries);
  assert.deepEqual(f.group.children, [f.anchor, butler, localProject, checklist, ...entries, following]);
  assert.deepEqual(f.rail.children, [railAction]);
  assert.equal(railAction.className, 'native-icon-rail');
  for (const entry of entries) {
    assert.equal(entry.className, f.anchor.className);
    assert.equal(entry.children.length, 1);
    const row = entry.children[0], [icon, label] = row.children;
    assert.equal(row.tagName, 'DIV'); assert.match(row.className, /flex min-w-0 items-center gap-nav-row-content text-base flex-1/);
    assert.equal(icon.tagName, 'SPAN'); assert.match(icon.className, /icon-leading-slot/); assert.equal(icon.children[0].tagName, 'SVG');
    assert.equal(label.className, 'text-fade-truncate'); assert.match(label.getAttribute('style'), /text-overflow:ellipsis;white-space:nowrap/);
    entry.click();
  }
  assert.deepEqual(routes, definitions.map(item => item.module));
  f.resetWrites(); installNativeSidebarModuleEntries(f.documentRef, f.anchor, definitions, NATIVE_ENTRY_ICONS, () => {});
  assert.equal(f.writes, 0, 'stable installation must not wake the mutation observer');
});

test('new rows keep module routes and one listener while adopting an updated callback', () => {
  const f = fixture(), first = [], updated = [];
  const entries = installNativeSidebarModuleEntries(f.documentRef, f.anchor, definitions, NATIVE_ENTRY_ICONS, module => first.push(module));
  for (const entry of entries) assert.deepEqual(entry.click(), { prevented: 1, stopped: 1 });
  assert.deepEqual(first, definitions.map(item => item.module));
  f.resetWrites(); installNativeSidebarModuleEntries(f.documentRef, f.anchor, definitions, NATIVE_ENTRY_ICONS, module => updated.push(module));
  assert.equal(f.writes, 0);
  for (const entry of entries) { assert.equal(entry.listeners.length, 1); entry.click(); }
  assert.deepEqual(updated, first);
});

test('a remounted action group receives the existing entries and then remains stable', () => {
  const f = fixture();
  const entries = installNativeSidebarModuleEntries(f.documentRef, f.anchor, definitions, NATIVE_ENTRY_ICONS, () => {});
  const newGroup = f.documentRef.createElement('div'); f.root.insertBefore(newGroup, null);
  const nextAnchor = f.add(newGroup, {}, 'sidebar-item flex bg-primary-ghost-hover selected hover:bg-primary-ghost-hover');
  installNativeSidebarModuleEntries(f.documentRef, nextAnchor, definitions, NATIVE_ENTRY_ICONS, () => {});
  assert.deepEqual(newGroup.children, [nextAnchor, ...entries]);
  assert.deepEqual(f.group.children, [f.anchor]);
  for (const entry of entries) { assert.doesNotMatch(entry.className, /(?:^| )selected(?: |$)|(?:^| )bg-primary-ghost-hover(?: |$)/); assert.match(entry.className, /hover:bg-primary-ghost-hover/); }
  f.resetWrites(); installNativeSidebarModuleEntries(f.documentRef, nextAnchor, definitions, NATIVE_ENTRY_ICONS, () => {});
  assert.equal(f.writes, 0);
});

test('a checklist in another group cannot move the modules away from their native anchor', () => {
  const f = fixture(), unrelated = f.documentRef.createElement('div'); f.root.insertBefore(unrelated, null);
  const checklist = f.add(unrelated, { 'data-ccc-general-checklist-entry': '' });
  const nativeAfter = f.add(f.group, { 'data-native-after': '' });
  const entries = installNativeSidebarModuleEntries(f.documentRef, f.anchor, definitions, NATIVE_ENTRY_ICONS, () => {});
  assert.deepEqual(f.group.children, [f.anchor, ...entries, nativeAfter]);
  assert.deepEqual(unrelated.children, [checklist]);
  f.resetWrites(); installNativeSidebarModuleEntries(f.documentRef, f.anchor, definitions, NATIVE_ENTRY_ICONS, () => {});
  assert.equal(f.writes, 0);
});

test('duplicate owned entries are removed and damaged content is repaired', () => {
  const f = fixture(), entries = installNativeSidebarModuleEntries(f.documentRef, f.anchor, definitions, NATIVE_ENTRY_ICONS, () => {});
  f.add(f.rail, { 'data-board': '' }); entries[1].innerHTML = '<span>damaged</span>'; entries[2].style.cssText = 'display:block';
  installNativeSidebarModuleEntries(f.documentRef, f.anchor, definitions, NATIVE_ENTRY_ICONS, () => {});
  assert.equal(f.documentRef.querySelectorAll('[data-board]').length, 1);
  assert.equal(entries[1].children[0].tagName, 'DIV'); assert.match(entries[2].style.cssText, /display:flex/);
  f.resetWrites(); installNativeSidebarModuleEntries(f.documentRef, f.anchor, definitions, NATIVE_ENTRY_ICONS, () => {});
  assert.equal(f.writes, 0);
});

test('without checklist, module fallback preserves the native dot pair and ready top actions', () => {
  for (const ready of ['dot', 'butler', 'open']) {
    const f = fixture(), dot = f.add(f.group, { 'data-sidebar-destination': 'builtin:orbit' });
    const actions = [dot];
    if (ready !== 'dot') actions.push(f.add(f.group, { 'data-codex-control-console-butler-entry': '' }));
    if (ready === 'open') actions.push(f.add(f.group, { 'data-codex-control-console-open-local-project': '' }));
    const entries = installNativeSidebarModuleEntries(f.documentRef, f.anchor, definitions, NATIVE_ENTRY_ICONS, () => {});
    assert.deepEqual(f.group.children, [f.anchor, ...actions, ...entries]);
    f.resetWrites(); installNativeSidebarModuleEntries(f.documentRef, f.anchor, definitions, NATIVE_ENTRY_ICONS, () => {});
    assert.equal(f.writes, 0);
  }
});

test('serialized helper is self-contained and a rail anchor cannot receive module entries', () => {
  const f = fixture(), context = vm.createContext({ documentRef: f.documentRef, anchor: f.anchor, definitions, icons: NATIVE_ENTRY_ICONS, routes: [] });
  vm.runInContext(`(${installNativeSidebarModuleEntries.toString()})(documentRef, anchor, definitions, icons, module => routes.push(module))`, context);
  assert.equal(f.group.children.length, 5); f.group.children[1].click(); assert.equal(context.routes[0], 'board');
  const railAnchor = f.add(f.rail); f.resetWrites();
  assert.deepEqual(installNativeSidebarModuleEntries(f.documentRef, railAnchor, definitions, NATIVE_ENTRY_ICONS, () => {}), []);
  assert.equal(f.writes, 0);
  assert.deepEqual(installNativeSidebarModuleEntries(f.documentRef, null, definitions, NATIVE_ENTRY_ICONS, () => {}), []);
});
