import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeRemoteTemplates } from '../src/native-remote-sidebar-templates.mjs';

class Node {
  constructor(tag, className = '') { this.tag = tag; this.className = className; this.children = []; this.attrs = {}; this.textContent = ''; }
  get firstElementChild() { return this.children[0] || null; }
  append(...nodes) { for (const node of nodes) { node.parentElement = this; this.children.push(node); } }
  setAttribute(name, value) { this.attrs[name] = value; }
  cloneNode() { const copy = new Node(this.tag, this.className); copy.cloned = this; return copy; }
  querySelector(selector) { return this.lookup?.[selector] || null; }
}

function environment() {
  const state = { projects: null, rows: {} };
  const documentRef = { createElement: tag => new Node(tag), createElementNS: (_, tag) => new Node(tag), querySelector: selector => state.rows[selector] || null };
  return { state, read: createNativeRemoteTemplates(documentRef, () => state.projects) };
}

test('remote rows keep native styling when every native section is collapsed', () => {
  const { read } = environment(), templates = read();
  assert.match(templates.sectionClass, /px-row-x/);
  assert.match(templates.projectClass, /sidebar-item/); assert.match(templates.projectClass, /h-\[var\(--height-token-row\)\]/);
  assert.match(templates.threadClass, /sidebar-item/);
  assert.equal(templates.projectContent.children.length, 2, 'icon slot and label');
  const icon = templates.projectContent.children[0].children[0].children[0];
  assert.equal(icon.tag, 'svg'); assert.equal(icon.attrs.viewBox, '0 0 16 16'); assert.match(icon.children[0].attrs.d, /^M2 4\.5/);
  assert.equal(templates.projectContent.children[1].children[0].textContent, '…', 'label leaf exists for renaming');
  assert.equal(templates.threadContent.children[0].attrs['data-thread-title-trigger'], '');
  assert.notEqual(read().projectContent, templates.projectContent, 'fallback content is fresh per read');
});

test('a captured native template survives the native rows collapsing again', () => {
  const { state, read } = environment();
  const row = new Node('div', 'native-project-row'); row.append(new Node('div', 'native-content'));
  const section = new Node('section', 'native-section'); section.lookup = { '[data-app-action-sidebar-project-row]': row };
  state.projects = section;
  assert.equal(read().projectClass, 'native-project-row');
  state.projects = new Node('section', ''); state.projects.lookup = {};
  const cached = read();
  assert.equal(cached.projectClass, 'native-project-row');
  assert.equal(cached.sectionClass, 'native-section');
  assert.equal(cached.projectContent.className, 'native-content');
});
