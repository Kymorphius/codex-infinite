import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildNativeNewProjectsInjectionScript, buildNativeNewProjectsSnapshotScript } from '../src/native-new-projects.mjs';

class Node {
  constructor(tag = 'div') { this.tag = tag; this.children = []; this.attrs = {}; this.style = {}; this.listeners = {}; this.className = ''; }
  append(...nodes) { for (const node of nodes) { this.children.push(node); node.parentElement = this; } }
  insertBefore(node, before) { this.children.splice(this.children.indexOf(before), 0, node); node.parentElement = this; }
  remove() { if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null; }
  setAttribute(key, value) { this.attrs[key] = value; }
  addEventListener(key, fn) { this.listeners[key] = fn; }
  querySelector() { return null; }
}
function all(node) { return [node, ...node.children.flatMap(all)]; }
function harness() {
  const parent = new Node(); const wrapper = new Node(); const native = new Node('section'); const nativeRow = new Node();
  const nativeCreate = new Node('button'); let creations = 0; nativeCreate.click = () => { creations += 1; };
  const nativeHeading = new Node(); nativeHeading.className = 'native-heading';
  nativeRow.className = 'native-project'; native.append(nativeRow); wrapper.append(native); parent.append(wrapper);
  native.querySelector = selector => selector.includes('nav-section-title') ? nativeHeading : selector.includes('project-create') ? nativeCreate : null;
  const document = { documentElement: parent, querySelectorAll: () => all(parent).filter(node => 'data-codex-control-console-new-projects' in node.attrs), createElementNS: (ns, tag) => new Node(tag), createElement: tag => new Node(tag), querySelector: selector => selector.includes('project-create') ? nativeCreate : selector.includes('Projects') ? native : nativeRow };
  const messages = []; const storage = new Map(); let now = Date.now(); let timer;
  const context = vm.createContext({ document, window: { postMessage: message => messages.push(message) },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    MutationObserver: class { observe() {} disconnect() {} }, requestAnimationFrame: callback => callback(),
    setInterval: callback => { timer = callback; return 1; }, clearInterval() {}, Date: { now: () => now } });
  const run = () => vm.runInContext(buildNativeNewProjectsInjectionScript(), context);
  const set = items => vm.runInContext(buildNativeNewProjectsSnapshotScript(items), context);
  const find = attribute => all(parent).find(node => node.attrs[attribute]);
  return { parent, wrapper, nativeRow, creations: () => creations, run, set, find, messages, context, expire: () => { now += 10_000; timer(); } };
}
test('additional project view preserves native rows, disclosure navigates same task and expiry removes alias', () => {
  const h = harness(); h.run();
  const id = '01a04cd6-8d30-78f1-b2a7-f760d148f744';
  h.set([{ id: 'p', name: '<project>', expiresAt: Date.now() + 5000, tasks: [{ id, title: '<task>' }] }]);
  const alias = h.find('data-new-project-id');
  assert.ok(alias); assert.equal(alias.tag, 'button'); assert.equal(alias.attrs['aria-expanded'], 'false');
  assert.equal(h.wrapper.children[0].children[0], h.nativeRow);
  alias.listeners.click();
  const task = h.find('data-new-project-thread-id');
  assert.equal(task.children[0].textContent, '<task>');
  task.listeners.click();
  assert.equal(h.messages[0].path, '/local/' + id);
  const count = h.parent.children.length;
  h.run(); assert.equal(h.parent.children.length, count);
  h.expire(); assert.equal(h.find('data-new-project-id'), undefined);
  assert.equal(h.wrapper.children[0].children[0], h.nativeRow);
});
test('empty category is rendered with native heading classes and no custom background', () => {
  const h = harness(); h.run(); h.set([]);
  assert.ok(all(h.parent).some(node => node.textContent === '暂无新项目'));
  assert.ok(all(h.parent).some(node => node.className === 'native-heading'));
  assert.doesNotMatch(buildNativeNewProjectsInjectionScript(), /background:|innerHTML|cloneNode/);
  assert.equal(all(h.parent).find(node => node.textContent === '新项目').parentElement.tag, 'button');
});
test('automatic category rejects drag and drop without disabling disclosure', () => {
  const h = harness(); h.run();
  const root = h.parent.children.find(node => 'data-codex-control-console-new-projects' in node.attrs);
  assert.equal(root.attrs.draggable, 'false');
  for (const type of ['dragstart', 'dragenter', 'dragover', 'drop']) {
    let prevented = false; let stopped = false;
    const dataTransfer = { dropEffect: 'move' };
    root.listeners[type]({ preventDefault() { prevented = true; }, stopPropagation() { stopped = true; }, dataTransfer });
    assert.ok(prevented && stopped);
    assert.equal(dataTransfer.dropEffect, 'none');
  }
  let stopped = false;
  root.listeners.pointerdown({ stopPropagation() { stopped = true; } });
  assert.ok(stopped);
  const toggle = all(root).find(node => node.tag === 'button');
  assert.equal(toggle.attrs.draggable, 'false');
  toggle.listeners.click();
  assert.equal(all(h.parent).find(node => node.tag === 'button').attrs['aria-expanded'], 'false');
});

test('reinjection clears orphan roots and disposed callbacks cannot resurrect old roots', () => {
  const h = harness();
  const orphan = new Node(); orphan.setAttribute('data-codex-control-console-new-projects', '');
  h.parent.append(orphan); h.run();
  assert.equal(h.parent.children.length, 2);
  h.context.window.__codexControlConsoleNewProjects.dispose();
  h.expire();
  assert.equal(h.parent.children.length, 1);
});

test('native section padding and SVG disclosure replace the simplified layout', () => {
  const h = harness(); h.wrapper.children[0].className = 'relative px-row-x'; h.run();
  const root = h.parent.children.find(node => 'data-codex-control-console-new-projects' in node.attrs);
  assert.equal(root.children[0].className, 'relative px-row-x');
  assert.ok(all(root).some(node => node.tag === 'svg' && node.attrs.class.includes('icon-disclosure')));
  assert.ok(!all(root).some(node => ['⌄', '›'].includes(node.textContent)));
});

test('heading plus delegates exactly once to native project creation', () => {
  const h = harness(); h.run();
  const create = h.find('data-new-project-create');
  assert.equal(create.attrs['aria-label'], '添加新项目');
  assert.equal(create.attrs.draggable, 'false');
  assert.equal(create.disabled, undefined);
  create.listeners.click(); assert.equal(h.creations(), 1);
});
