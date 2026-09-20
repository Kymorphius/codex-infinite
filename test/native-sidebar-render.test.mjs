import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createSourceSidebarRenderer } from '../src/native-sidebar-render.mjs';
class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.style = {}; }
  append(...nodes) { for (const node of nodes) { node.remove(); node.parentElement = this; this.children.push(node); } }
  remove() { if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null; }
  setAttribute(key, value) { this.attributes[key] = value; }
  getAttribute(key) { return this.attributes[key] ?? null; }
  addEventListener() {}
  querySelector() { return this.children.find(node => node.tag === 'section'); }
  get lastChild() { return this.children.at(-1); }
  get isConnected() { return Boolean(this.parentElement); }
}
const descendants = root => [root, ...root.children.flatMap(descendants)];
function source(id, sections) { return { device: { id, name: id, kind: 'remote-codex' }, status: 'connected', snapshot: {
  sections: sections.map(([sectionId, name]) => ({ id: sectionId, name, kind: 'custom', collapsed: false, itemKeys: ['p'], hiddenItemCount: 0 })),
  projects: [{ key: 'p', id: 'p', name: 'Same name', conversationKeys: [], childrenLoaded: true }], conversations: [] } }; }
test('remote rows follow source sections; same names merge and duplicate owner names stay separate', () => {
  const parent = new Node('parent'), wrapper = new Node('wrapper'), projects = new Node('section'), waitingWrapper = new Node('wrapper'), waiting = new Node('section'), nativeRow = new Node('native-row');
  projects.append(nativeRow); wrapper.append(projects); waitingWrapper.append(waiting); parent.append(wrapper, waitingWrapper);
  const sections = [{ id: 'threads', name: 'Projects', kind: 'projects', node: projects, native: { collapsed: false } },
    { id: 'custom:local', name: '等待', kind: 'custom', node: waiting, native: { collapsed: false } }];
  const menuCalls = [];
  const context = vm.createContext({ document: { createElement: tag => new Node(tag) }, readModel: () => ({ sections }), onItem: (...args) => menuCalls.push(args), openConversation() {} });
  const renderer = vm.runInContext(`(${createSourceSidebarRenderer.toString()})({readModel,onItem,openConversation})`, context);
  const one = source('windows', [['custom:w', '等待'], ['custom:unique', '异地'], ['custom:duplicate', '异地']]);
  const two = source('mac', [['custom:m', '等待'], ['custom:elsewhere', '异地']]);
  renderer.render([one, two]);
  assert.equal(projects.children[0], nativeRow);
  assert.deepEqual(waitingWrapper.children.slice(1).map(node => node.attributes['data-codex-sidebar-source']), ['windows', 'mac']);
  const mirrors = parent.children.filter(node => ![wrapper, waitingWrapper].includes(node));
  assert.equal(mirrors.length, 2); // One shared remote-only heading, plus one duplicate native section.
  assert.equal(mirrors[0].children.filter(node => node.attributes['data-codex-sidebar-source']).length, 2);
  const remoteRow = descendants(waitingWrapper).find(node => node.attributes['data-codex-sidebar-item'] === 'p');
  remoteRow.oncontextmenu({ preventDefault() {} }); assert.equal(menuCalls[0][0].device.id, 'windows'); assert.equal(menuCalls[0][1].id, 'custom:w');
  waiting.setAttribute('data-app-action-sidebar-section-collapsed', 'true'); renderer.place();
  assert.equal(waitingWrapper.children[1].hidden, true);
  renderer.clear(); assert.deepEqual(parent.children, [wrapper, waitingWrapper]); assert.deepEqual(projects.children, [nativeRow]);
});
