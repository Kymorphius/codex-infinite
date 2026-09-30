import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildNativeTerminalProviderSource } from '../src/native-terminal-provider.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const attribute = key => 'data-' + key.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase());
function element(tag = 'div') {
  const attrs = {}, node = { nodeType: 1, tagName: tag.toUpperCase(), children: [], parentElement: null, style: {},
    getAttribute: key => attrs[key] ?? null, setAttribute(key, value) { attrs[key] = String(value); },
    addEventListener() {}, removeEventListener() {},
    matches(selector) { return selector.split(',').some(part => {
      part = part.trim();
      if (part.startsWith('#')) return attrs.id === part.slice(1);
      const match = /^(\w+)?\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(part);
      return Boolean(match && (!match[1] || match[1].toUpperCase() === this.tagName)
        && Object.hasOwn(attrs, match[2]) && (match[3] === undefined || attrs[match[2]] === match[3]));
    }); },
    closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; },
    querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    append(...nodes) { for (const child of nodes) { child.remove(); child.parentElement = this; this.children.push(child); } },
    insertBefore(child, before) { child.remove(); child.parentElement = this; const at = this.children.indexOf(before); this.children.splice(at < 0 ? this.children.length : at, 0, child); },
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; },
    get nextSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1] || null; },
    get previousElementSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) - 1] || null; },
    get isConnected() { let node = this; while (node.parentElement) node = node.parentElement; return node.tagName === 'HTML'; }
  };
  node.dataset = new Proxy({}, { set(_, key, value) { node.setAttribute(attribute(key), value); return true; },
    get(_, key) { return node.getAttribute(attribute(key)) ?? undefined; } });
  return node;
}

async function fixture({ conversations = [], fibers = 1000 } = {}) {
  const counts = { modelReads: 0, fiberVisits: 0, sections: 0, tabs: 0, search: 0, recent: 0, requests: 0 };
  const timers = new Map(), intervals = new Map(), observers = [], listeners = new Map(); let sequence = 0;
  const html = element('html'), head = element('head'), body = element('body'), main = element('main'), shell = element();
  shell.setAttribute('id', 'app-shell-sidebar'); html.append(head, body); body.append(shell, main);
  const sectionParent = element(), section = element('section');
  section.setAttribute('data-app-action-sidebar-section-heading', 'threads'); shell.append(sectionParent); sectionParent.append(section);
  const props = { sectionKey: 'threads', onCollapsedChange() {}, catalogSourcesReady: true, collapsed: false,
    children: { props: { projectByKey: new Map(), conversationByKey: new Map(), keys: [] } } };
  const tree = Array.from({ length: fibers }, () => ({ child: null, return: null, stateNode: null }));
  tree[1].stateNode = section; tree[1].memoizedProps = props;
  for (let index = 0; index < tree.length; index++) {
    tree[index].child = tree[index + 1] || null; tree[index].return = index ? tree[0] : null;
    Object.defineProperty(tree[index], 'sibling', { get() { counts.fiberVisits++; return null; } });
  }
  section.__reactFiber_fixture = tree[1];
  const document = { documentElement: html, head, body, createElement: element, addEventListener() {}, removeEventListener() {},
    querySelectorAll(selector) { if (selector === 'section[data-app-action-sidebar-section-heading]') counts.sections++; return html.querySelectorAll(selector); },
    querySelector: selector => html.querySelector(selector) };
  const state = { conversations, active: { kind: 'local' } };
  const client = name => ({ async request(operation) { counts.requests++; return { conversations: state.conversations, client: name, operation }; } });
  const window = { __cccTerminalNative: client('first'), addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name),
    __codexControlConsoleConversationTabs: { active: () => state.active, syncTerminal() { counts.tabs++; }, updateRecentSent() { counts.recent++; } },
    __codexControlConsoleProjectSearch: { refresh() { counts.search++; } } };
  const context = vm.createContext({ window, document, URL, Map, Set, counts, crypto: { randomUUID: () => 'synthetic' },
    MutationObserver: class { constructor(callback) { this.callback = callback; observers.push(this); } observe(target, options) { this.target = target; this.options = options; } disconnect() { this.disconnected = true; } },
    setTimeout: callback => { timers.set(++sequence, callback); return sequence; }, clearTimeout: id => timers.delete(id),
    setInterval: (callback, ms) => { intervals.set(++sequence, { callback, ms }); return sequence; }, clearInterval: id => intervals.delete(id)
  });
  vm.runInContext(buildNativeTerminalProviderSource() + `
    const countedModel = documentRef => { counts.modelReads++; return readNativeSidebarModel(documentRef); };
    globalThis.provider = installNativeTerminalProvider('http://127.0.0.1:47831', countedModel, createNativeTerminalSidebar, createNativeTerminalActions);
  `, context);
  await tick();
  const observer = observers.find(value => value.target === html);
  return { counts, state, client, window, document, provider: context.provider, observer, timers, intervals, shell, main, section, props,
    roots: () => document.querySelectorAll('[data-ccc-terminal-sidebar]'),
    reset() { for (const key of Object.keys(counts)) counts[key] = 0; },
    emit(records) { const delivered = records.filter(record => record.type !== 'attributes' || observer.options.attributeFilter.includes(record.attributeName)); if (delivered.length) observer.callback(delivered); },
    drain() { const queued = [...timers.values()]; timers.clear(); for (const callback of queued) callback(); } };
}

const record = { id: 'conversation', provider: 'terminal', deviceId: 'mac', title: 'Synthetic Claude', revision: 1, kind: 'claude', cwd: '/synthetic' };
const change = (target, overrides = {}) => ({ type: 'childList', target, addedNodes: [], removedNodes: [], ...overrides });

test('500 unrelated streaming batches do not rescan the actual 1,000-fiber sidebar model', async () => {
  const f = await fixture({ conversations: [record] }); assert.equal(f.counts.fiberVisits, 1000); f.reset();
  for (let index = 0; index < 500; index++) {
    f.emit([change(f.main, { addedNodes: [element('span')] }), change(f.main, { type: 'attributes', attributeName: 'class' })]); f.drain();
  }
  assert.deepEqual(f.counts, { modelReads: 0, fiberVisits: 0, sections: 0, tabs: 0, search: 0, recent: 0, requests: 0 });
  assert.equal(f.timers.size, 0); f.provider.dispose();
});

test('native folds, selection and terminal tab changes still coalesce and read a fresh model', async () => {
  const f = await fixture({ conversations: [record] }); f.reset(); f.props.collapsed = true;
  f.emit([change(f.section, { type: 'attributes', attributeName: 'data-app-action-sidebar-section-collapsed' })]);
  f.emit([change(f.section, { type: 'attributes', attributeName: 'aria-selected' })]);
  const tabs = element(); tabs.setAttribute('data-codex-control-console-native-tabs', ''); f.document.body.append(tabs);
  f.state.active = { kind: 'terminal', id: record.id };
  f.emit([change(f.document.body, { addedNodes: [tabs] })]);
  assert.equal(f.timers.size, 1); f.drain();
  assert.equal(f.counts.modelReads, 1); assert.equal(f.counts.fiberVisits, 1000);
  assert.equal(f.roots()[0].querySelector('[data-ccc-terminal-sidebar-row]').dataset.selected, 'true');
  f.props.collapsed = false; f.emit([change(f.section)]); f.drain(); assert.equal(f.counts.modelReads, 2);
  f.provider.dispose();
});

test('observer subscribes to native selection, bare fold controls and sidebar ancestor visibility', async () => {
  const f = await fixture({ conversations: [record] }); f.reset();
  for (const key of ['data-app-action-sidebar-thread-selected', 'aria-current', 'aria-expanded', 'class', 'style', 'hidden', 'aria-hidden']) {
    assert.ok(f.observer.options.attributeFilter.includes(key), `observer must deliver ${key}`);
  }
  const toggle = element('button'), thread = element('button');
  toggle.setAttribute('data-app-action-sidebar-section-toggle', ''); thread.setAttribute('data-app-action-sidebar-thread-id', 'local:synthetic');
  f.document.body.append(toggle, thread);
  f.emit([change(toggle, { type: 'attributes', attributeName: 'aria-expanded' })]);
  f.emit([change(thread, { type: 'attributes', attributeName: 'data-app-action-sidebar-thread-selected' })]);
  f.emit([change(thread, { type: 'attributes', attributeName: 'aria-current' })]);
  assert.equal(f.timers.size, 1); f.drain(); assert.equal(f.counts.modelReads, 1);
  const wrapper = element(); f.document.body.append(wrapper); wrapper.append(f.shell);
  f.emit([change(wrapper, { type: 'attributes', attributeName: 'hidden' })]); f.drain();
  assert.equal(f.counts.modelReads, 2, 'a sidebar ancestor visibility change is relevant'); f.provider.dispose();
});

test('owned rendering is ignored while external root removal and movement recover', async () => {
  const f = await fixture({ conversations: [record] }); f.reset();
  const first = f.roots()[0]; f.emit([change(first.children[0])]); f.drain(); assert.equal(f.counts.modelReads, 0);
  first.remove(); f.emit([change(f.shell, { removedNodes: [first] })]); f.drain();
  assert.equal(f.counts.modelReads, 1); assert.equal(f.roots().length, 1); assert.notEqual(f.roots()[0], first);
  const moved = f.roots()[0]; f.main.append(moved); f.emit([change(f.main, { addedNodes: [moved] })]); f.drain();
  assert.equal(f.counts.modelReads, 2); assert.equal(f.roots()[0].parentElement, f.shell);
  const current = f.roots()[0]; f.emit([change(current.children[0])]); f.drain(); assert.equal(f.counts.modelReads, 2);
  f.provider.dispose();
});

test('native sidebar ancestor remounts restore rows without caching React state', async () => {
  const f = await fixture({ conversations: [record] }); f.reset();
  const replacement = element(); replacement.setAttribute('id', 'app-shell-sidebar');
  replacement.append(f.section.parentElement); f.shell.remove(); f.document.body.append(replacement);
  f.emit([change(f.document.body, { removedNodes: [f.shell], addedNodes: [replacement] })]); f.drain();
  assert.equal(f.counts.modelReads, 1); assert.equal(f.roots().length, 1); assert.equal(f.roots()[0].parentElement, replacement);
  f.provider.dispose();
});

test('explicit metadata acceptance and 5-second refresh keep their freshness and rebuilt-client behavior', async () => {
  const f = await fixture({ conversations: [record] }); f.reset();
  f.provider.accept({ ...record, revision: 2, title: 'Renamed' });
  assert.equal(f.counts.modelReads, 1); assert.equal(f.roots()[0].querySelector('[data-terminal-title]').textContent, 'Renamed');
  f.state.conversations = [{ ...record, revision: 3, title: 'Periodic' }]; f.window.__cccTerminalNative = f.client('rebuilt');
  const interval = [...f.intervals.values()].find(value => value.ms === 5000); assert.ok(interval);
  await interval.callback(); assert.equal(f.counts.requests, 1); assert.equal(f.counts.modelReads, 2);
  assert.equal(f.roots()[0].querySelector('[data-terminal-title]').textContent, 'Periodic');
  f.emit([change(f.section)]); assert.equal(f.timers.size, 1);
  f.provider.dispose(); assert.equal(f.intervals.size, 0); assert.equal(f.timers.size, 0); assert.equal(f.observer.disconnected, true);
  f.emit([change(f.section)]); f.drain(); assert.equal(f.counts.modelReads, 2);
});
