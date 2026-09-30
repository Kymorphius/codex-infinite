import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { findNativeEntryAnchor, nativeLayoutTransition } from '../src/native-entry-probe.mjs';

class Node {
  constructor(tag, text = '', attributes = {}) {
    this.tagName = tag; this.textContent = text; this.attrs = new Map(Object.entries(attributes));
    this.children = []; this.style = {}; this.className = ''; this.parentElement = null;
  }
  get attributes() { return Array.from(this.attrs, ([name, value]) => ({ name, value })); }
  get isConnected() { return this.tagName === 'document' || Boolean(this.parentElement?.isConnected); }
  get innerText() { throw new Error('Ordinary anchor discovery must not force layout'); }
  getBoundingClientRect() { throw new Error('Anchor discovery must not measure layout'); }
  hasAttribute(name) { return this.attrs.has(name); }
  getAttribute(name) { return this.attrs.get(name) ?? null; }
  append(...nodes) {
    for (const node of nodes) {
      if (node.parentElement) node.parentElement.children.splice(node.parentElement.children.indexOf(node), 1);
      node.parentElement = this; this.children.push(node);
    }
  }
  remove() {
    this.parentElement?.children.splice(this.parentElement.children.indexOf(this), 1);
    this.parentElement = null;
  }
  matches(selector) {
    return selector.split(',').some(part => {
      const value = part.trim();
      if (value.includes(' ')) {
        const [ancestor, target] = value.split(/\s+/);
        return this.matches(target) && Boolean(this.parentElement?.closest(ancestor));
      }
      if (value.startsWith('#')) return this.getAttribute('id') === value.slice(1);
      if (value.startsWith('[')) {
        const match = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(value);
        return Boolean(match) && (match[2] === undefined ? this.hasAttribute(match[1]) : this.getAttribute(match[1]) === match[2]);
      }
      return value === this.tagName || value === 'button.sidebar-item' && this.tagName === 'button' && this.className.split(' ').includes('sidebar-item');
    });
  }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
  querySelectorAll(selector) {
    const result = [];
    for (const child of this.children) {
      if (child.matches(selector)) result.push(child);
      result.push(...child.querySelectorAll(selector));
    }
    return result;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

const trim = value => String(value || '').replace(/\s+/g, ' ').trim();
function latestSidebar(label = '新聊天') {
  const document = new Node('document');
  const frame = new Node('div', '', { 'data-app-shell-sidebar-open': 'true' });
  const rail = new Node('nav', '', { 'data-app-navigation-rail': '' });
  const railApps = new Node('button', 'Apps');
  const shell = new Node('aside', '', { id: 'app-shell-sidebar' });
  const pane = new Node('div', '', { 'data-slate-sidebar-content': '' });
  const actions = new Node('div');
  const newChat = new Node('button', label);
  const scroll = new Node('div', '', { 'data-app-action-sidebar-scroll': '' });
  document.append(frame); frame.append(rail, shell); rail.append(railApps);
  shell.append(pane); pane.append(actions, scroll); actions.append(newChat);
  return { document, frame, rail, railApps, shell, pane, actions, newChat, scroll };
}

test('latest sidebar prefers its text action over the earlier Apps icon rail', () => {
  for (const label of ['新聊天', '新对话', '新建任务', 'New chat', 'New task']) {
    const fixture = latestSidebar(label);
    fixture.actions.append(new Node('button', 'Apps'));
    assert.equal(findNativeEntryAnchor(fixture.document, trim), fixture.newChat);
    assert.equal(fixture.newChat.parentElement, fixture.actions, 'top actions are outside the lower scroll area');
  }
});

test('text action aria label supports an icon-only native button without layout reads', () => {
  const fixture = latestSidebar('');
  fixture.newChat.attrs.set('aria-label', 'New chat');
  fixture.actions.append(new Node('button', 'Settings'));
  assert.equal(findNativeEntryAnchor(fixture.document, trim), fixture.newChat);
});

test('cached text anchor is replaced after a pane remount and cannot migrate into the rail', () => {
  const fixture = latestSidebar();
  const cache = {};
  assert.equal(findNativeEntryAnchor(fixture.document, trim, cache), fixture.newChat);
  fixture.rail.append(fixture.newChat);
  const replacement = new Node('button', 'New chat');
  fixture.actions.append(replacement);
  assert.equal(findNativeEntryAnchor(fixture.document, trim, cache), replacement);
  fixture.pane.remove();
  const pane = new Node('div', '', { 'data-slate-sidebar-content': '' });
  const remounted = new Node('button', '新聊天');
  fixture.shell.append(pane); pane.append(remounted);
  assert.equal(findNativeEntryAnchor(fixture.document, trim, cache), remounted);
  assert.equal(cache.node, remounted);
});

test('a legacy cached rail anchor is rejected when a modern text pane appears', () => {
  const fixture = latestSidebar();
  const cache = { node: fixture.railApps };
  assert.equal(findNativeEntryAnchor(fixture.document, trim, cache), fixture.newChat);
});

test('closed, hidden, and inert text panes clear cached anchors without choosing the rail', () => {
  for (const [attribute, value] of [['hidden', ''], ['inert', ''], ['aria-hidden', 'true']]) {
    const fixture = latestSidebar(), cache = {};
    assert.equal(findNativeEntryAnchor(fixture.document, trim, cache), fixture.newChat);
    fixture.pane.attrs.set(attribute, value);
    assert.equal(findNativeEntryAnchor(fixture.document, trim, cache), null);
    assert.equal(cache.node, null);
  }
  const fixture = latestSidebar();
  fixture.frame.attrs.set('data-app-shell-sidebar-open', 'false');
  assert.equal(findNativeEntryAnchor(fixture.document, trim), null);
  fixture.frame.attrs.set('data-app-shell-sidebar-open', 'true');
  fixture.pane.style.display = 'none';
  assert.equal(findNativeEntryAnchor(fixture.document, trim), null);
});

test('injected entries and dialog or menu actions cannot become native anchors', () => {
  const fixture = latestSidebar();
  fixture.newChat.remove();
  for (const attributes of [{ 'data-ccc-general-checklist-entry': '' }, { 'data-codex-control-console-entry': '' }]) {
    fixture.actions.append(new Node('button', 'New chat', attributes));
  }
  const injected = new Node('button', 'New chat'); injected.className = 'ccc-native-new'; fixture.actions.append(injected);
  for (const role of ['dialog', 'menu']) {
    const overlay = new Node('div', '', { role }); overlay.append(new Node('button', 'New chat')); fixture.pane.append(overlay);
  }
  const hidden = new Node('button', 'New chat', { hidden: '' }); fixture.actions.append(hidden);
  assert.equal(findNativeEntryAnchor(fixture.document, trim), null);
});

test('rail-only layouts wait and legacy sidebar action labels remain supported', () => {
  const fixture = latestSidebar(); fixture.shell.remove();
  assert.equal(findNativeEntryAnchor(fixture.document, trim), null);
  for (const label of ['插件', 'Apps', '站点', 'Sites', '已安排', 'Scheduled']) {
    const oldSidebar = new Node('div', '', { 'data-app-action-sidebar-scroll': '' });
    const action = new Node('button', label); oldSidebar.append(action); fixture.frame.append(oldSidebar);
    const cache = {};
    assert.equal(findNativeEntryAnchor(fixture.document, trim, cache), action);
    assert.equal(findNativeEntryAnchor(fixture.document, trim, cache), action);
    oldSidebar.remove();
  }
});

test('normal layout recognizes current text actions without a lower scroll marker and still leaves for settings', () => {
  const fixture = latestSidebar(); fixture.scroll.remove();
  assert.deepEqual(nativeLayoutTransition(fixture.document, false), { normal: true, leftNormal: false });
  fixture.shell.remove();
  assert.deepEqual(nativeLayoutTransition(fixture.document, true), { normal: false, leftNormal: true });
  const legacy = new Node('div', '', { 'data-app-action-sidebar-scroll': '' }); fixture.frame.append(legacy);
  assert.deepEqual(nativeLayoutTransition(fixture.document, false), { normal: true, leftNormal: false });
});

test('current sidebar discovery and layout transition serialize without module dependencies', () => {
  const fixture = latestSidebar(); fixture.scroll.remove();
  const context = vm.createContext({ document: fixture.document, trim });
  assert.equal(vm.runInContext(`(${findNativeEntryAnchor.toString()})(document, trim)`, context), fixture.newChat);
  assert.equal(vm.runInContext(`(${nativeLayoutTransition.toString()})(document, false).normal`, context), true);
});
