import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildNativeRemoteSidebarInjectionScript } from '../src/native-remote-sidebar.mjs';
import { buildNativeTerminalProviderSource } from '../src/native-terminal-provider.mjs';

const ROOT = '[data-codex-control-console-remote-sidebar]';
const snapshot = [{ id: 'remote', name: 'Remote', status: 'connected', projectCount: 0, conversationCount: 0, projects: [] }];
function fixture({ selected = '' } = {}) {
  const counts = { sections: 0, projectClones: 0, threadClones: 0, iconClones: 0, orderWrites: 0, replacements: 0, styles: 0 };
  const frames = [], records = [], observers = [], timers = new Map(); let document, sequence = 0;
  const notify = record => { if (record.target.isConnected && observers.some(value => value.active)) records.push(record); };
  class Node {
    constructor(tag = 'div') {
      this.nodeType = 1; this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null; this.attrs = {}; this.text = '';
      this.style = new Proxy({}, { set: (target, key, value) => {
        if (key === 'order') counts.orderWrites++;
        if (target[key] !== value) { target[key] = value; notify({ type: 'attributes', target: this, attributeName: 'style' }); }
        return true;
      } });
      this.classList = { contains: name => this.className.split(/\s+/).includes(name) };
      const attribute = key => 'data-' + key.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase());
      this.dataset = new Proxy({}, { get: (_, key) => this.getAttribute(attribute(key)) ?? undefined,
        set: (_, key, value) => { this.setAttribute(attribute(key), value); return true; } });
    }
    get className() { return this.attrs.class || ''; } set className(value) { this.setAttribute('class', value); }
    get id() { return this.attrs.id || ''; } set id(value) { this.setAttribute('id', value); }
    get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
    set textContent(value) { this.text = String(value); this.replaceChildren(); }
    get firstElementChild() { return this.children[0] || null; }
    get nextSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1] || null; }
    get previousElementSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) - 1] || null; }
    get isConnected() { let node = this; while (node.parentElement) node = node.parentElement; return node === document?.documentElement; }
    getAttribute(key) { return this.attrs[key] ?? null; }
    setAttribute(key, value) { if (this.attrs[key] !== String(value)) { this.attrs[key] = String(value); notify({ type: 'attributes', target: this, attributeName: key }); } }
    removeAttribute(key) { if (Object.hasOwn(this.attrs, key)) { delete this.attrs[key]; notify({ type: 'attributes', target: this, attributeName: key }); } }
    toggleAttribute(key, value) { value ? this.setAttribute(key, '') : this.removeAttribute(key); }
    addEventListener() {} removeEventListener() {}
    matches(selector) {
      return selector.split(',').some(part => {
        part = part.trim(); const negative = /:not\(([^)]+)\)/.exec(part);
        if (negative && this.matches(negative[1])) return false;
        part = part.replace(/:not\([^)]+\)/, '');
        if (part.startsWith('#')) return this.id === part.slice(1);
        const tag = /^\w+/.exec(part)?.[0]; if (tag && tag.toUpperCase() !== this.tagName) return false;
        for (const name of part.matchAll(/\.([\w-]+)/g)) if (!this.classList.contains(name[1])) return false;
        for (const attr of part.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)) {
          if (!Object.hasOwn(this.attrs, attr[1]) || attr[2] !== undefined && this.attrs[attr[1]] !== attr[2]) return false;
        }
        return Boolean(tag || part.includes('[') || part.includes('.'));
      });
    }
    closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; }
    querySelectorAll(selector) {
      const at = selector.indexOf(' ');
      if (at > 0) return this.querySelectorAll(selector.slice(0, at)).flatMap(node => node.querySelectorAll(selector.slice(at + 1)));
      return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    append(...nodes) { for (const node of nodes) this.insertBefore(node, null); }
    appendChild(node) { this.append(node); return node; }
    insertBefore(node, before) {
      node.remove(); node.parentElement = this;
      const index = this.children.indexOf(before); this.children.splice(index < 0 ? this.children.length : index, 0, node);
      notify({ type: 'childList', target: this, addedNodes: [node], removedNodes: [] }); return node;
    }
    remove() {
      const parent = this.parentElement; if (!parent) return;
      parent.children = parent.children.filter(child => child !== this); this.parentElement = null;
      notify({ type: 'childList', target: parent, addedNodes: [], removedNodes: [this] });
    }
    replaceWith(node) {
      const parent = this.parentElement; if (!parent) return;
      if (this.matches(ROOT)) counts.replacements++;
      parent.insertBefore(node, this); this.remove();
    }
    replaceChildren(...nodes) { for (const child of [...this.children]) child.remove(); this.append(...nodes); }
    cloneNode(deep) {
      if (this.source) counts[this.source]++;
      const copy = new Node(this.tagName); copy.attrs = { ...this.attrs }; copy.text = this.text;
      if (deep) copy.append(...this.children.map(child => child.cloneNode(true))); return copy;
    }
  }
  const create = (tag, attrs = {}, text = '') => { const node = new Node(tag); node.attrs = { ...attrs }; node.text = text; return node; };
  const html = create('html'), head = create('head'), body = create('body'), main = create('main');
  document = { documentElement: html, body, head, createElement: tag => create(tag), createElementNS: (_, tag) => create(tag),
    getElementById: id => html.querySelector('#' + id), querySelector: selector => html.querySelector(selector),
    querySelectorAll(selector) { if (selector === 'section') counts.sections++; return html.querySelectorAll(selector); },
    addEventListener() {}, removeEventListener() {} };
  html.append(head, body); body.append(main);
  const outer = create('div'), pane = create('div', { 'data-slate-sidebar-content': '' }), wrapper = create('div');
  const section = create('section', { 'data-app-action-sidebar-section-heading': 'Projects', class: 'native-section' });
  const toggle = create('button', { 'data-app-action-sidebar-section-toggle': '', class: 'native-toggle' });
  const heading = create('span', { class: 'min-w-0 truncate' }, 'Projects'); toggle.append(heading);
  const project = create('div', { 'data-app-action-sidebar-project-row': '', 'aria-labelledby': 'native-project', class: 'native-project' });
  const content = create('div', { class: 'native-content' }), icon = create('svg');
  const label = create('span', { id: 'native-project' }, 'Project'); content.append(icon, label); project.append(content);
  const thread = create('div', { 'data-app-action-sidebar-thread-id': 'native-thread', class: 'native-thread' });
  const threadContent = create('div', { class: 'flex h-full' }); threadContent.append(create('span', { class: 'text-base' }, 'Thread')); thread.append(threadContent);
  content.source = 'projectClones'; icon.source = 'iconClones'; threadContent.source = 'threadClones';
  section.append(toggle, project, thread); wrapper.append(section); pane.append(wrapper); outer.append(pane); body.append(outer);
  const window = { __codexControlConsoleSelectedRemoteConversation: selected, addEventListener() {}, removeEventListener() {} };
  const context = vm.createContext({ window, document, URL, Set, Map, location: { href: 'http://127.0.0.1:47831' },
    navigator: {}, requestAnimationFrame: callback => { frames.push(callback); return frames.length; },
    crypto: { randomUUID: () => 'synthetic' }, setTimeout: callback => { timers.set(++sequence, callback); return sequence; },
    clearTimeout: id => timers.delete(id), setInterval: () => ++sequence, clearInterval() {},
    getComputedStyle: () => { counts.styles++; return { fontFamily: 'system-ui', fontSize: '14px', fontWeight: '400', lineHeight: '20px' }; },
    MutationObserver: class { constructor(callback) { this.callback = callback; observers.push(this); } observe(_, options) { this.options = options; this.active = true; } disconnect() { this.active = false; } } });
  const drain = () => {
    for (let index = 0; frames.length || records.length || timers.size; index++) {
      assert.ok(index < 30, 'render mutations must settle');
      const pending = records.splice(0);
      for (const observer of observers.filter(value => value.active)) {
        const selected = pending.filter(record => record.type === 'attributes'
          ? observer.options.attributes && observer.options.attributeFilter?.includes(record.attributeName)
          : observer.options[record.type]);
        if (selected.length) observer.callback(selected);
      }
      const queued = frames.splice(0); for (const callback of queued) callback();
      const callbacks = [...timers.values()]; timers.clear(); for (const callback of callbacks) callback();
    }
  };
  vm.runInContext(buildNativeRemoteSidebarInjectionScript(), context); window.__codexControlConsoleSetRemoteSidebar(snapshot); drain();
  return { counts, frames, document, context, window, Node, create, main, outer, pane, wrapper, section, toggle, content, thread,
    drain, root: () => document.querySelector(ROOT), timers,
    emit(record) { observers.filter(value => value.active).forEach(value => value.callback([record])); },
    reset() { for (const key of Object.keys(counts)) counts[key] = 0; },
    stream() { this.emit({ type: 'childList', target: main, addedNodes: [create('span')], removedNodes: [] }); drain(); } };
}

test('500 unrelated body batches cause no scans, clones, style reads, writes or render feedback', () => {
  const f = fixture(), root = f.root(); f.reset();
  for (let index = 0; index < 500; index++) f.stream();
  assert.deepEqual(f.counts, { sections: 0, projectClones: 0, threadClones: 0, iconClones: 0, orderWrites: 0, replacements: 0, styles: 0 });
  assert.equal(f.root(), root); assert.equal(f.frames.length, 0);
  f.window.__codexControlConsoleSetRemoteSidebar(snapshot); f.drain(); assert.equal(f.counts.orderWrites, 0);
  assert.equal(f.counts.replacements, 0, 'unchanged explicit snapshots preserve the tree');
});

test('native collapsed controls, selection, descendant styles, themes and source identity stay fresh', () => {
  const f = fixture();
  for (const [target, key, value] of [[f.toggle, 'data-app-action-sidebar-section-collapsed', 'true'],
    [f.toggle, 'aria-expanded', 'false'],
    [f.thread, 'aria-current', 'page'], [f.content.children[1], 'class', 'new-label'],
    [f.document.documentElement, 'data-theme', 'light'], [f.outer, 'hidden', '']]) {
    const before = f.root(); target.setAttribute(key, value); f.drain(); assert.notEqual(f.root(), before);
  }
  f.reset(); const old = f.root(), replacement = f.content.cloneNode(true); replacement.children[1].textContent = 'New source';
  f.content.replaceWith(replacement); f.drain(); assert.notEqual(f.root(), old);
  f.reset(); for (let index = 0; index < 20; index++) f.stream(); assert.equal(f.counts.sections, 0);
});

test('external removal, different-parent and same-parent moves restore canonical placement', () => {
  const f = fixture(); f.reset(); const root = f.root();
  root.remove(); f.drain(); assert.equal(f.root(), root); assert.equal(root.nextSibling, f.wrapper);
  f.main.append(root); f.drain(); assert.equal(root.parentElement, f.pane); assert.equal(root.nextSibling, f.wrapper);
  f.pane.append(root); f.drain(); assert.equal(root.nextSibling, f.wrapper);
  root.style.order = '99'; f.drain(); assert.equal(root.style.order, '32');
  assert.equal(f.counts.replacements, 0, 'placement repair does not rebuild valid templates');
});

test('native ancestor remounts and temporarily absent native sections recover without idle work', () => {
  const f = fixture(), root = f.root(), nextPane = f.create('div', { 'data-slate-sidebar-content': '' });
  nextPane.append(f.wrapper); f.pane.replaceWith(nextPane); f.drain();
  assert.equal(f.root().parentElement, nextPane); assert.notEqual(f.root(), root);
  f.wrapper.remove(); f.drain(); f.reset();
  for (let index = 0; index < 20; index++) f.stream(); assert.equal(f.counts.sections, 0);
  nextPane.append(f.wrapper); f.drain(); assert.equal(f.root().parentElement, nextPane); assert.equal(f.root().nextSibling, f.wrapper);
});

test('snapshot replacement and unified transitions settle; reinstall owns one observer and subtree', () => {
  const f = fixture(), first = f.root();
  f.window.__codexControlConsoleSetRemoteSidebar([{ ...snapshot[0], name: 'Updated' }]); f.drain(); assert.notEqual(f.root(), first);
  f.reset(); f.stream(); assert.equal(f.counts.sections, 0, 'the snapshot render cannot feed back');
  f.window.__codexControlConsoleUnifiedSidebar = { enabled: true }; f.stream(); assert.equal(f.root(), null);
  f.reset(); f.stream(); assert.equal(f.counts.sections, 0);
  f.window.__codexControlConsoleUnifiedSidebar.enabled = false; f.stream(); assert.ok(f.root());
  f.reset(); vm.runInContext(buildNativeRemoteSidebarInjectionScript(), f.context); f.drain(); assert.equal(f.counts.sections, 0);
  assert.equal(f.document.querySelectorAll(ROOT).length, 1);
});

test('actual terminal provider and expanded selected remote rows settle without cross-observer feedback', async () => {
  const f = fixture({ selected: 'remote\nremote-thread' });
  const list = f.create('div', { 'data-app-action-sidebar-project-list-id': 'local-project' }); f.section.append(list);
  f.section.__reactFiber_fixture = { stateNode: f.section, memoizedProps: { sectionKey: 'threads', heading: 'Projects',
    onCollapsedChange() {}, catalogSourcesReady: true, children: { props: { projectByKey: new Map(), conversationByKey: new Map(), keys: [] } } } };
  const record = { id: 'terminal', deviceId: 'mac', provider: 'terminal', kind: 'claude', revision: 1, title: 'Terminal',
    projectRef: { source: 'codex', hostId: 'local', id: 'project' } };
  f.window.__cccTerminalNative = { async request() { return { conversations: [record] }; } };
  f.context.terminalCounts = { reads: 0 };
  vm.runInContext(buildNativeTerminalProviderSource() + `
    const counted = documentRef => { terminalCounts.reads++; return readNativeSidebarModel(documentRef); };
    globalThis.provider = installNativeTerminalProvider('http://127.0.0.1:47831', counted, createNativeTerminalSidebar, createNativeTerminalActions);
  `, f.context);
  await new Promise(resolve => setImmediate(resolve)); f.drain();
  f.window.__codexControlConsoleExpandedRemoteDevices.add('remote');
  f.window.__codexControlConsoleExpandedRemoteProjects.add('remote\np');
  f.window.__codexControlConsoleSetRemoteSidebar([{ ...snapshot[0], projects: [{ key: 'p', name: 'Project', conversationCount: 1,
    conversations: [{ id: 'remote-thread', title: 'Selected remote' }] }] }]); f.drain();
  assert.ok(f.root().querySelector('[data-app-action-sidebar-thread-selected="true"]'));
  const terminal = list.querySelector('[data-ccc-terminal-sidebar]'); assert.ok(terminal);
  f.reset(); const before = f.context.terminalCounts.reads;
  terminal.firstElementChild.className = 'changed-terminal-row'; f.drain();
  assert.equal(list.querySelector('[data-ccc-terminal-sidebar]'), terminal, 'unchanged terminal placement does not rebuild');
  assert.ok(f.counts.replacements <= 1, 'foreign style updates cause at most one template refresh');
  assert.ok(f.context.terminalCounts.reads - before <= 1, 'remote refresh causes at most one terminal sync');
  f.reset(); const idle = f.context.terminalCounts.reads;
  for (let index = 0; index < 500; index++) f.stream();
  assert.equal(f.context.terminalCounts.reads, idle); assert.equal(f.counts.sections, 0); assert.equal(f.timers.size, 0);
  f.context.provider.dispose(); f.drain();
});
