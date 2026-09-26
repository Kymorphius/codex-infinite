import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskCenterController } from '../public/features/task-center/controller.js';
import { createTaskCenterView } from '../public/features/task-center/view.js';

class Element {
  constructor(tag = 'div') {
    this.tag = tag; this.childNodes = []; this.dataset = {}; this.hidden = false; this.disabled = false; this.classes = new Set();
    this.listeners = new Map(); this.classList = { toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name) };
  }
  get firstChild() { return this.childNodes[0] || null; }
  get nextSibling() { return this.parent?.childNodes[this.parent.childNodes.indexOf(this) + 1] || null; }
  get textContent() { return this.text || ''; }
  set textContent(value) { this.text = value; this.childNodes = []; }
  append(...nodes) { for (const child of nodes) this.insertBefore(child, null); }
  insertBefore(child, before) {
    child.remove(); const index = before ? this.childNodes.indexOf(before) : this.childNodes.length;
    assert.ok(index >= 0, 'insertion anchor must belong to the same list'); this.childNodes.splice(index, 0, child); child.parent = this;
  }
  remove() { if (this.parent) { this.parent.childNodes.splice(this.parent.childNodes.indexOf(this), 1); this.parent = null; } }
  replaceWith(child) { const parent = this.parent, next = this.nextSibling; this.remove(); parent.insertBefore(child, next); }
  replaceChildren(...nodes) { for (const child of [...this.childNodes]) child.remove(); this.append(...nodes); }
  addEventListener(type, callback) { this.listeners.set(type, callback); }
  querySelectorAll(selector) { return this.childNodes.flatMap(child => [...(selector.split(',').includes(child.tag) ? [child] : []), ...child.querySelectorAll(selector)]); }
  focus() { this.focused = true; }
}

async function setup() {
  let data = { version: 1, localDeviceId: 'mac', devices: [{ device: { id: 'mac', name: 'Mac' }, status: 'connected', items: ['one', 'two'].map(id => ({
    id, key: id, ownerDeviceId: 'mac', scopeId: 'scope', source: 'checklist', text: `任务 ${id}`, createdAt: '2026-09-26', revision: 'one'
  })) }] };
  const elements = new Map(), root = new Element();
  root.querySelector = selector => { if (!elements.has(selector)) elements.set(selector, new Element(selector.includes('editor') ? 'form' : 'div')); return elements.get(selector); };
  let view;
  const controller = createTaskCenterController({ request: async () => data, render: state => view.render(state) });
  view = createTaskCenterView({ root, documentRef: { createElement: tag => new Element(tag) }, controller, tasks: () => [], requestOpen() {}, formatDate: value => value });
  await controller.load();
  return { controller, elements, setData(value) { data = value; }, data };
}

test('unchanged directory refresh keeps row elements; only changed tasks are replaced', async () => {
  const { controller, elements, data, setData } = await setup();
  const list = elements.get('[data-task-center-list]'); const [one, two] = list.childNodes;
  setData({ ...data, devices: [{ ...data.devices[0], updatedAt: 'a later read time' }] });
  await controller.load({ explicit: true });
  assert.equal(list.childNodes[0], one); assert.equal(list.childNodes[1], two);
  setData({ ...data, devices: [{ ...data.devices[0], items: [data.devices[0].items[0], { ...data.devices[0].items[1], text: '已更新', revision: 'two' }] }] });
  await controller.load({ explicit: true });
  assert.equal(list.childNodes[0], one); assert.notEqual(list.childNodes[1], two);
  assert.equal(list.childNodes.length, 2);
});

test('background changes retain textarea node, current draft, focus and editor revision', async () => {
  const { controller, elements, data, setData } = await setup();
  controller.edit('edit', 'one');
  const form = elements.get('[data-task-center-editor]'); const [textarea] = form.querySelectorAll('textarea');
  textarea.value = '还在输入的草稿'; controller.draft({ text: textarea.value });
  setData({ ...data, devices: [{ ...data.devices[0], items: [{ ...data.devices[0].items[0], revision: 'two', text: '其他设备修改' }, data.devices[0].items[1]] }] });
  await controller.load({ explicit: true });
  assert.equal(form.querySelectorAll('textarea')[0], textarea); assert.equal(textarea.value, '还在输入的草稿'); assert.equal(textarea.focused, true);
  assert.equal(controller.getState().editor.revision, 'one'); assert.equal(controller.getState().editor.text, textarea.value);
});

test('filtering and restoring keeps source order without duplicate rows or stale anchors', async () => {
  const { controller, elements } = await setup(); const list = elements.get('[data-task-center-list]');
  controller.filter({ query: 'two' }); assert.deepEqual(list.childNodes.map(element => element.dataset.taskCenterKey), ['two']);
  controller.filter({ query: '' }); assert.deepEqual(list.childNodes.map(element => element.dataset.taskCenterKey), ['one', 'two']);
  controller.filter({ query: 'nothing' }); assert.equal(list.childNodes.length, 0);
  controller.filter({ query: '' }); assert.equal(list.childNodes.length, 2);
});

test('delivery reservation shows review message, blocks row management and locks an open editor while keeping cancel available', async () => {
  const { controller, elements, data, setData } = await setup();
  controller.edit('edit', 'one');
  const form = elements.get('[data-task-center-editor]'), [textarea] = form.querySelectorAll('textarea');
  textarea.value = '保留草稿'; controller.draft({ text: textarea.value });
  const reserved = { ...data.devices[0].items[0], deliveryReservation: { token: 'reserved', assignedDeviceId: 'mac', assignedThreadId: '01a0ac42-2552-7141-8ec9-12c50515ac4a' } };
  setData({ ...data, devices: [{ ...data.devices[0], items: [reserved, data.devices[0].items[1]] }] });
  await controller.load({ explicit: true });
  const row = elements.get('[data-task-center-list]').childNodes[0];
  assert.ok(row.querySelectorAll('span').some(element => element.textContent === '待核对'));
  assert.ok(row.querySelectorAll('p').some(element => /核对目标会话是否已收到/.test(element.textContent)));
  const controls = row.querySelectorAll('button');
  assert.ok(controls.filter(element => element.dataset.taskCenterAction !== 'open').every(element => element.disabled));
  assert.equal(controls.find(element => element.dataset.taskCenterAction === 'open').disabled, false);
  assert.equal(form.querySelectorAll('textarea')[0], textarea); assert.equal(textarea.value, '保留草稿'); assert.equal(textarea.disabled, true);
  assert.equal(form.querySelectorAll('button').find(element => element.type === 'submit').disabled, true);
  assert.equal(form.querySelectorAll('button').find(element => element.textContent === '取消').disabled, false);
});
