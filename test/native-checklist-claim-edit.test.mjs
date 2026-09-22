import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildNativeProjectChecklistScript } from '../src/native-project-checklist.mjs';
import { ProjectChecklistStore } from '../src/project-checklist-store.mjs';

const generalKey = 'ccc:general-inbox:v1';
const threadA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', threadB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const task = { id: 'task-a', text: '原来的任务', done: false, assignedThreadId: null, createdAt: '2026-09-20T01:02:03.000Z' };
const otherTask = { ...task, id: 'task-b', text: '无关的另一个任务', createdAt: '2026-09-21T01:02:03.000Z' };
const claimButton = row => row.children.find(node => node.tag === 'button' && node.textContent === '领取');
const claim = row => claimButton(row).listeners.click();
const change = row => row.children[0].listeners.change();
const key = (input, value, extra = {}) => input.listeners.keydown({ key: value, preventDefault() {}, stopPropagation() {}, ...extra });

function harness(saved = '[]', items = [task]) {
  let document;
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.listeners = {}; this.value = ''; this.selectionStart = this.selectionEnd = 0; }
    append(...nodes) { for (const node of nodes) if (node && typeof node === 'object') node.parent = this; this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
    replaceWith(...nodes) { const index = this.parent?.children.indexOf(this) ?? -1; if (index >= 0) { for (const node of nodes) if (node && typeof node === 'object') node.parent = this.parent; this.parent.children.splice(index, 1, ...nodes); } }
    setAttribute(k, v) { this.attrs[k] = v; }
    addEventListener(k, fn) { this.listeners[k] = fn; }
    focus() { document.activeElement = this; }
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
    select() {} remove() {} showModal() { this.open = true; } close() { this.open = false; }
  }
  let storage = saved, id = 0;
  const idle = [], listeners = {};
  document = { activeElement: null, body: new Node('body'), head: new Node('head'), createElement: tag => Object.assign(new Node(tag), { ownerDocument: document }), querySelectorAll: () => [] };
  const context = vm.createContext({ document, window: { requestIdleCallback: fn => idle.push(fn), addEventListener: (name, fn) => { listeners[name] = fn; }, removeEventListener() {} }, crypto: { randomUUID: () => 'edit-id-' + ++id }, localStorage: { getItem: () => storage, setItem: (_, value) => { storage = value; } } });
  vm.runInContext(buildNativeProjectChecklistScript(), context);
  const api = context.window.__cccProjectChecklist, dialog = document.body.children[0];
  api.cacheGeneral(items); api.openClaimableForCurrentThread(threadA);
  return { api, dialog, document, list: dialog.children[4], row: () => dialog.children[4].children[0], status: () => dialog.children[5].textContent, storage: () => storage, idle, listeners };
}

test('claim rows are directly editable and claiming reads the current textarea without change or blur', () => {
  const h = harness(), row = h.row(), text = row.children[0];
  assert.equal(text.tag, 'textarea'); assert.equal(text.disabled, false);
  assert.deepEqual(row.children.filter(node => node.tag === 'button').map(node => node.textContent), ['领取']);
  text.value = '  1. 修改内容\n2. 保留换行  '; claim(row);
  const [action] = h.api.packet().actions;
  assert.equal(h.api.packet().actions.length, 1);
  assert.equal(action.type, 'upsert'); assert.equal(action.projectKey, generalKey);
  assert.equal(action.id, task.id); assert.equal(action.text, '1. 修改内容\n2. 保留换行');
  assert.equal(action.assignedThreadId, threadA); assert.equal(action.done, false); assert.equal(action.createdAt, task.createdAt);
  assert.equal(h.list.children.some(value => value.children[0]?.value === action.text), false);
});

test('change saves in place so the same claim button click cannot be swallowed by a blur rerender', () => {
  const h = harness(), row = h.row(), button = claimButton(row);
  row.children[0].value = '失去焦点时保存'; change(row);
  const [edit] = h.api.packet().actions;
  assert.equal(edit.text, '失去焦点时保存'); assert.equal(edit.assignedThreadId, null);
  assert.equal(edit.id, task.id); assert.equal(edit.createdAt, task.createdAt);
  assert.equal(h.row(), row); assert.equal(claimButton(h.row()), button);
  button.listeners.click();
  assert.equal(h.api.packet().actions.length, 2);
  assert.equal(h.api.packet().actions[1].text, edit.text); assert.equal(h.api.packet().actions[1].assignedThreadId, threadA);
});

test('claim after an autosave uses subsequent unsaved text, not the last saved baseline', () => {
  const h = harness(), row = h.row(); row.children[0].value = '第一次自动保存'; change(row);
  row.children[0].value = '第二次直接领取的新内容'; claim(row);
  const actions = h.api.packet().actions;
  assert.equal(actions.length, 2); assert.equal(actions[0].assignedThreadId, null);
  assert.equal(actions[1].text, '第二次直接领取的新内容'); assert.equal(actions[1].assignedThreadId, threadA);
  assert.equal(actions[1].id, task.id); assert.equal(actions[1].createdAt, task.createdAt);
});

test('Enter saves without claiming; Shift+Enter and IME confirmation retain normal multiline input', () => {
  const h = harness(), row = h.row(), text = row.children[0]; text.value = '1. 第一行\n2. 第二行';
  for (const extra of [{ shiftKey: true }, { isComposing: true }]) {
    key(text, 'Enter', { ...extra, preventDefault() { assert.fail('newline and IME Enter must not be intercepted'); } });
    assert.equal(h.api.packet().actions.length, 0);
  }
  key(text, 'Enter');
  assert.equal(h.api.packet().actions[0].text, text.value); assert.equal(h.api.packet().actions[0].assignedThreadId, null);
  assert.equal(h.row(), row); assert.equal(text.disabled, false);
});

test('empty or overlong input cannot save or claim and is preserved for correction', () => {
  for (const invalid of ['   ', 'x'.repeat(5001)]) {
    for (const action of [change, claim]) {
      const h = harness(), row = h.row(); row.children[0].value = invalid; action(row);
      assert.equal(h.api.packet().actions.length, 0); assert.equal(h.row(), row);
      assert.equal(row.children[0].value, invalid); assert.equal(row.children[0].disabled, false);
      assert.match(h.status(), invalid.length > 5000 ? /5000|过长|太长/ : /空|内容/);
      row.children[0].value = '修正后的任务'; claim(row);
      assert.equal(h.api.packet().actions[0].text, '修正后的任务'); assert.equal(h.api.packet().actions[0].assignedThreadId, threadA);
    }
  }
});

test('unchanged input creates no autosave action and exactly 5000 characters remain valid', () => {
  const h = harness(), row = h.row(); row.children[0].value = '  ' + task.text + '  '; change(row);
  assert.equal(h.api.packet().actions.length, 0);
  row.children[0].value = 'x'.repeat(5000); change(row);
  assert.equal(h.api.packet().actions[0].text.length, 5000); assert.equal(h.api.packet().actions[0].assignedThreadId, null);
});

test('saved edits survive pending reload and acknowledgement preserves a newer unsaved input', () => {
  const h = harness(), row = h.row(); row.children[0].value = '待保存的修改'; change(row);
  const [action] = h.api.packet().actions, restored = harness(h.storage()), restoredRow = restored.row();
  assert.equal(restoredRow.children[0].value, action.text); assert.equal(restoredRow.children.at(-1).attrs.datetime, task.createdAt);
  restoredRow.children[0].value = '尚未保存的下一次编辑';
  restored.api.accept({ projectKey: generalKey, items: [{ ...task, text: action.text, updatedAt: '2026-09-22T00:00:00.000Z' }], acknowledged: [action.requestId] });
  assert.equal(restored.api.packet().actions.length, 0); assert.equal(restored.row(), restoredRow);
  assert.equal(restoredRow.children[0].value, '尚未保存的下一次编辑');
  claim(restoredRow);
  assert.equal(restored.api.packet().actions[0].text, '尚未保存的下一次编辑');
  assert.equal(restored.api.packet().actions[0].createdAt, task.createdAt);
});

test('old change and claim callbacks cannot write after render, project or claim target switches and close', () => {
  const switches = [
    h => h.api.accept({ projectKey: generalKey, items: [task, otherTask], acknowledged: [] }),
    h => h.api.open({ key: 'another-project' }),
    h => h.api.openClaimableForCurrentThread(threadB),
    h => h.api.openGeneral(),
    h => h.dialog.close()
  ];
  for (const switchPanel of switches) {
    const h = harness(), row = h.row(); row.children[0].value = '旧行不应覆盖'; switchPanel(h);
    change(row); claim(row); assert.equal(h.api.packet().actions.length, 0);
  }
});

test('new general snapshots prevent stale writes after text, assignment, completion or removal changes', () => {
  for (const items of [[], [{ ...task, text: '别人已经编辑' }], [{ ...task, assignedThreadId: threadB }], [{ ...task, done: true }]]) {
    const h = harness(), row = h.row(); row.children[0].value = '不可覆盖的新草稿'; h.api.cacheGeneral(items);
    change(row); claim(row); assert.equal(h.api.packet().actions.length, 0, JSON.stringify(items));
  }
});

test('unrelated background updates retain draft, focus and selection through a rerender', () => {
  const h = harness(), row = h.row(), text = row.children[0]; text.value = '后台刷新时保留本地草稿'; text.focus(); text.setSelectionRange(2, 5);
  h.api.accept({ projectKey: generalKey, items: [task, otherTask], acknowledged: [] });
  const restored = h.row().children[0];
  assert.notEqual(h.row(), row); assert.equal(restored.value, '后台刷新时保留本地草稿');
  assert.equal(h.document.activeElement, restored); assert.equal(restored.selectionStart, 2); assert.equal(restored.selectionEnd, 5);
  claim(h.row()); assert.equal(h.api.packet().actions[0].text, '后台刷新时保留本地草稿');
});

test('a draft restored after its task changes externally cannot overwrite the changed baseline', () => {
  const h = harness(), row = h.row(); row.children[0].value = '保留但不可自动覆盖的草稿'; row.children[0].focus();
  h.api.accept({ projectKey: generalKey, items: [{ ...task, text: '服务器已经修改' }, otherTask], acknowledged: [] });
  assert.equal(h.row().children[0].value, '保留但不可自动覆盖的草稿');
  change(h.row()); claim(h.row());
  assert.equal(h.api.packet().actions.length, 0); assert.match(h.status(), /状态已变化|任务已变化|已被修改/);
});

test('claimable dialog neither loads held todos nor lets a held update redraw direct edits', () => {
  const h = harness(), row = h.row(); assert.equal(h.idle.length, 0); assert.equal(h.list.children.length, 1);
  assert.doesNotMatch(h.dialog.children[3].textContent, /正在加载会话待办/);
  row.children[0].value = '不应被后台重绘打断'; h.listeners['codex-control-console-held-todos-changed']?.();
  assert.equal(h.idle.length, 0); assert.equal(h.row(), row); assert.equal(row.children[0].value, '不应被后台重绘打断');
});

test('an idle callback queued by the general panel cannot redraw the claim editor', () => {
  const h = harness(); h.api.openGeneral(); assert.equal(h.idle.length, 1); h.api.openClaimableForCurrentThread(threadA);
  const row = h.row(); row.children[0].value = '保留领取面板的编辑'; h.idle[0]();
  assert.equal(h.row(), row); assert.equal(row.children[0].value, '保留领取面板的编辑'); assert.equal(h.api.packet().actions.length, 0);
});

test('autosave followed by an unblurred claim persists exactly one task with latest text and initial time', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'checklist-claim-edit-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new ProjectChecklistStore(directory);
  await store.apply({ ...task, projectKey: generalKey, type: 'upsert', requestId: 'seed-edit-task' });
  const h = harness('[]', (await store.read(generalKey)).items), row = h.row();
  row.children[0].value = '保存后的内容'; change(row); row.children[0].value = '领取时的最终内容'; claim(row);
  const actions = h.api.packet().actions; assert.equal(actions.length, 2);
  for (const action of actions) await store.apply(action);
  const items = (await new ProjectChecklistStore(directory).read(generalKey)).items;
  assert.equal(items.length, 1); assert.equal(items[0].id, task.id); assert.equal(items[0].text, '领取时的最终内容');
  assert.equal(items[0].assignedThreadId, threadA); assert.equal(items[0].createdAt, task.createdAt);
  h.api.accept({ projectKey: generalKey, items, acknowledged: actions.map(action => action.requestId) });
  assert.equal(h.api.packet().actions.length, 0); assert.equal(h.list.children.some(value => value.children[0]?.value === items[0].text), false);
});
