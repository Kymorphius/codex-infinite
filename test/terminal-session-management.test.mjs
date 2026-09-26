import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerminalManagement } from '../public/features/sessions/terminal-management.js';

const settle = () => new Promise(resolve => setTimeout(resolve, 10));
const record = (fields = {}) => ({ id: 'terminal-one', deviceId: 'local', provider: 'terminal', title: 'Original',
  revision: 1, cwd: '/workspace', pinned: false, archived: false, ...fields });
function harness() {
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.listeners = new Map(); this.value = ''; this.open = false; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    setAttribute(name, value) { this[name] = value; }
    contains(element) { return this === element || this.children.some(child => child.contains(element)); }
    fire(type) { this.listeners.get(type)?.({}); }
  }
  const documentRef = new Element('document'); documentRef.createElement = tag => new Element(tag);
  const panel = new Element('section'); const state = { terminalConversations: [record()], tasks: [], devices: [] };
  const requests = []; let renders = 0, feature;
  function render(options) { if (feature.deferRender(options)) return; renders++; feature.renderArchives(); }
  feature = createTerminalManagement({ state, panel, documentRef, render,
    fetchImpl: (url, options) => new Promise(resolve => requests.push({ input: JSON.parse(options.body), resolve })) });
  const details = feature.controls(state.terminalConversations[0]);
  const input = details.children.find(value => value.tag === 'input');
  const button = label => details.children.find(value => value.textContent === label);
  const draft = value => { input.value = value; input.fire('input'); };
  const reply = value => requests.at(-1).resolve({ ok: true, json: async () => ({ conversation: value }) });
  return { feature, state, panel, documentRef, render, details, input, button, draft, requests, reply, renders: () => renders };
}

test('background refresh preserves open management, unsaved draft and caret until editing ends', async () => {
  const h = harness(); h.details.open = true; h.documentRef.activeElement = h.input;
  h.draft('Draft title'); h.input.selectionStart = 4; h.input.selectionEnd = 4;
  h.render(); h.render(); assert.equal(h.renders(), 0);
  assert.equal(h.input.value, 'Draft title'); assert.equal(h.input.selectionStart, 4);
  h.documentRef.activeElement = null; h.details.fire('focusout'); await settle();
  assert.equal(h.renders(), 1);
  assert.equal(h.feature.controls(record({ revision: 2, title: 'External' })), h.details);
  assert.equal(h.details.open, true); assert.equal(h.input.value, 'Draft title');
});

test('a pointer press holds refresh until after the management button receives its click', async () => {
  const h = harness(); h.draft('Clicked title');
  h.details.fire('pointerdown'); h.render(); assert.equal(h.renders(), 0);
  h.documentRef.fire('pointerup');
  assert.equal(h.renders(), 0);
  h.button('保存名称').fire('click');
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].input.title, 'Clicked title');
  h.reply(record({ title: 'Clicked title', revision: 2 })); await settle();
  assert.equal(h.state.terminalConversations[0].title, 'Clicked title');
});

test('filters may explicitly rebuild while cached draft and disclosure remain available', () => {
  const h = harness(); h.details.open = true; h.documentRef.activeElement = h.input; h.draft('Keep me');
  h.render(); h.render({ force: true });
  assert.equal(h.renders(), 1);
  assert.equal(h.feature.controls(record()), h.details); assert.equal(h.details.open, true);
  assert.equal(h.input.value, 'Keep me');
});

test('concurrent revision cannot be silently overwritten by an old rename draft', async () => {
  const h = harness(); h.draft('My draft');
  h.state.terminalConversations = [record({ title: 'Another editor', revision: 2 })];
  h.button('保存名称').fire('click');
  assert.equal(h.requests.length, 0); assert.equal(h.input.value, 'My draft');
  assert.match(h.panel.children[0].textContent, /已在其他位置更新/u);
  h.button('恢复最新名称').fire('click'); assert.equal(h.input.value, 'Another editor');
  h.draft('Reviewed new name'); h.button('保存名称').fire('click');
  assert.equal(h.requests[0].input.expectedRevision, 2);
  h.reply(record({ title: 'Reviewed new name', revision: 3 })); await settle();
  assert.equal(h.input.value, 'Reviewed new name');
});

test('pin and archive use current revisions without dropping an unsaved rename draft', async () => {
  const h = harness(); h.draft('Unsaved');
  h.state.terminalConversations = [record({ revision: 2, pinned: false })];
  h.button('置顶').fire('click'); assert.equal(h.requests[0].input.expectedRevision, 2);
  h.reply(record({ pinned: true, revision: 3 })); await settle();
  h.feature.controls(h.state.terminalConversations[0]);
  assert.equal(h.input.value, 'Unsaved'); assert.ok(h.button('取消置顶'));
  h.button('归档').fire('click'); assert.equal(h.requests[1].input.expectedRevision, 3);
  h.reply(record({ pinned: true, archived: true, revision: 4 })); await settle();
  assert.equal(h.state.terminalConversations[0].archived, true);
  assert.equal(h.input.value, 'Unsaved'); assert.ok(h.button('恢复会话'));
});

test('a late save receipt cannot regress a newer background record', async () => {
  const h = harness(); h.draft('Saved title'); h.button('保存名称').fire('click');
  h.state.terminalConversations = [record({ title: 'Newest title', revision: 3 })];
  h.reply(record({ title: 'Saved title', revision: 2 })); await settle();
  assert.equal(h.state.terminalConversations[0].title, 'Newest title');
  assert.equal(h.input.value, 'Newest title');
});

test('typing during a pending save retains the newer draft and can save it against that receipt', async () => {
  const h = harness(); h.draft('First title'); h.button('保存名称').fire('click'); h.draft('Second title');
  h.reply(record({ title: 'First title', revision: 2 })); await settle();
  assert.equal(h.input.value, 'Second title'); h.button('保存名称').fire('click');
  assert.equal(h.requests.length, 2); assert.equal(h.requests[1].input.expectedRevision, 2);
  h.reply(record({ title: 'Second title', revision: 3 })); await settle();
  assert.equal(h.input.value, 'Second title');
});
