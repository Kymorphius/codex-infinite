import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installUnifiedSidebar } from '../src/native-unified-sidebar.mjs';
import { buildNativeRemoteSidebarInjectionScript } from '../src/native-remote-sidebar.mjs';

class Node {
  constructor() { this.children = []; this.attributes = new Map(); this.style = {}; this.listeners = {}; }
  append(node) { node.remove(); this.children.push(node); node.parentElement = this; }
  insertBefore(node, before) { node.remove(); const index = this.children.indexOf(before); this.children.splice(index < 0 ? this.children.length : index, 0, node); node.parentElement = this; }
  remove() { if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null; }
  setAttribute(key, value) { this.attributes.set(key, value); }
  getAttribute(key) { return this.attributes.get(key); }
  hasAttribute(key) { return this.attributes.has(key); }
  addEventListener(key, fn) { this.listeners[key] = fn; }
  querySelector() { return this.toggle; }
}
function setup(stored = '{}') {
  const parent = new Node(); const all = [];
  const add = key => {
    const wrapper = new Node(), section = new Node(), nativeRow = new Node();
    section.setAttribute('data-app-action-sidebar-section-heading', key);
    section.toggle = new Node(); section.toggle.textContent = key; section.toggle.setAttribute('aria-expanded', 'true');
    section.append(nativeRow); wrapper.append(section); parent.append(wrapper); all.push(section); return section;
  };
  const projects = add('Projects'), waiting = add('等待'); add('Recents');
  let value = stored, changes = 0, observer;
  const window = { addEventListener() {}, removeEventListener() {} };
  const context = vm.createContext({ window, document: { createElement: () => new Node(), querySelectorAll: () => all, documentElement: parent },
    localStorage: { getItem: () => value, setItem: (key, next) => { value = next; } },
    requestAnimationFrame: fn => fn(), MutationObserver: class { constructor(fn) { observer = fn; } observe() {} disconnect() {} } });
  context.onChange = () => { changes += 1; };
  const run = () => vm.runInContext(`(${installUnifiedSidebar.toString()})(onChange)`, context);
  const api = run();
  return { parent, projects, waiting, all, add, api, run, window, changes: () => changes, value: () => value, update: () => observer(),
    button: () => parent.children.find(node => node.hasAttribute('data-codex-control-console-unified-control')).children[0] };
}
const device = { id: 'windows' }, project = { key: 'same' };

test('toggle persists and reinjection cleans owned UI while preserving native nodes', () => {
  const h = setup(); const nativeRow = h.projects.children[0];
  assert.equal(h.api.enabled, false); h.button().listeners.click();
  assert.equal(h.api.enabled, true); assert.equal(JSON.parse(h.value()).enabled, true);
  assert.equal(h.button().getAttribute('aria-pressed'), 'true'); assert.equal(h.changes(), 1);
  const group = h.api.container(device, project); h.api.place();
  assert.equal(group.parentElement, h.projects.parentElement);
  const next = h.run(); assert.equal(next.enabled, true); assert.equal(group.parentElement, null);
  assert.equal(h.projects.children[0], nativeRow);
  assert.equal(h.parent.children.filter(node => node.hasAttribute('data-codex-control-console-unified-control')).length, 1);
});

test('unified groups follow native collapse and project identity includes device', () => {
  const h = setup('{"enabled":true}');
  assert.equal(h.api.assign(device, project, '等待'), true);
  assert.equal(h.api.destination(device, project), '等待');
  assert.equal(h.api.destination({ id: 'mac' }, project), 'Projects');
  const group = h.api.container(device, project); h.api.place();
  assert.equal(group.parentElement, h.waiting.parentElement);
  h.waiting.toggle.setAttribute('aria-expanded', 'false'); h.update();
  assert.equal(group.style.display, 'none');
  h.waiting.toggle.setAttribute('aria-expanded', 'true'); h.update();
  assert.equal(group.style.display, 'flex');
  h.button().listeners.click(); assert.equal(group.parentElement, null);
  assert.equal(h.api.destination(device, project), '等待');
});

test('missing or ambiguous custom sections fall back to Projects and automatic sections are excluded', () => {
  const h = setup('{"enabled":true}'); h.api.assign(device, project, '等待');
  h.add('等待'); assert.equal(h.api.destination(device, project), 'Projects');
  assert.equal(h.api.assign(device, project, 'Recents'), false);
  h.all.splice(1); assert.equal(h.api.destination(device, project), 'Projects');
});

test('malformed storage is harmless and generated script retains owner routing and offline guard', () => {
  assert.equal(setup('{bad').api.enabled, false);
  const source = buildNativeRemoteSidebarInjectionScript();
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /if \(!unifiedSidebar.enabled\) nextRoot.append\(nativeSectionHeader\('远端'/);
  assert.match(source, /unifiedSidebar.enabled \? device.projects/);
  assert.match(source, /const available = device.status === 'connected'/);
  assert.match(source, /id: conversation.id, deviceId: device.id/);
  assert.match(source, /unifiedSidebar.assign\(device, project, target.key\)/);
});
