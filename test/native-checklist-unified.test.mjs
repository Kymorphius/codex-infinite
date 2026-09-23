import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildNativeProjectChecklistScript } from '../src/native-project-checklist.mjs';

const generalKey = 'ccc:general-inbox:v1';
const threadA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const threadB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const early = { id: 'early', text: 'Alpha 中文任务', done: false, assignedThreadId: null, createdAt: '2026-09-20T01:02:03.000Z' };
const later = { ...early, id: 'later', text: 'Beta 另一个任务', createdAt: '2026-09-21T01:02:03.000Z' };
const walk = node => [node, ...node.children.flatMap(walk)];
const find = (node, predicate) => walk(node).find(predicate);
const button = (row, label) => find(row, node => node.tag === 'button' && node.textContent === label);
const editor = row => find(row, node => node.attrs['aria-label'] === '任务内容');
const click = (row, label) => button(row, label).listeners.click();

function harness({ mode = 'general', items = [later, early], held = [] } = {}) {
  let document, sequence = 0;
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.listeners = {}; this.value = ''; this.hidden = false; this.selectionStart = this.selectionEnd = 0; }
    append(...nodes) { for (const node of nodes) node.parent = this; this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
    replaceWith(...nodes) { const index = this.parent?.children.indexOf(this) ?? -1; if (index >= 0) { for (const node of nodes) node.parent = this.parent; this.parent.children.splice(index, 1, ...nodes); } }
    setAttribute(key, value) { this.attrs[key] = value; }
    getAttribute(key) { return this.attrs[key] ?? null; }
    addEventListener(name, handler) { this.listeners[name] = handler; }
    focus() { document.activeElement = this; }
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
    remove() {} showModal() { this.open = true; } close() { this.open = false; }
  }
  const idle = [], storage = new Map([['codex-control-console.native-held-queue.v1', JSON.stringify({ [threadA]: held })]]);
  const choices = [{ getAttribute: key => key.includes('thread-id') ? 'local:' + threadA : '当前会话', textContent: '当前会话' }];
  document = { activeElement: null, body: new Node('body'), head: new Node('head'), createElement: tag => Object.assign(new Node(tag), { ownerDocument: document }), querySelectorAll: () => choices };
  const context = vm.createContext({ document, window: { requestIdleCallback: fn => idle.push(fn), addEventListener() {}, removeEventListener() {} }, crypto: { randomUUID: () => 'unified-' + ++sequence }, localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } });
  vm.runInContext(buildNativeProjectChecklistScript(), context);
  const api = context.window.__cccProjectChecklist;
  api.cacheGeneral(items);
  if (mode === 'claim') api.openClaimableForCurrentThread(threadA);
  else if (mode === 'new-claim') api.openClaimableForNewThread();
  else if (mode === 'general') api.openGeneral();
  else { api.open({ key: 'project-a' }); api.accept({ projectKey: 'project-a', items, acknowledged: [] }); }
  const dialog = document.body.children[0], list = find(dialog, node => node.tag === 'ul');
  const search = find(dialog, node => node.attrs['aria-label'] === '搜索任务');
  const searchRoot = search?.parent;
  return { api, dialog, document, list, search, searchRoot, idle,
    query(value) { search.value = value; search.listeners.input(); },
    status: () => find(dialog, node => node.attrs.role === 'status').textContent,
    rows: () => list.children.filter(row => row.children.some(node => node.tag === 'time')),
    visible: () => list.children.filter(row => !row.hidden && row.children.some(node => node.tag === 'time')),
    accept(values, acknowledged = []) { api.accept({ projectKey: mode === 'project' ? 'project-a' : generalKey, items: values, acknowledged }); }
  };
}

test('all checklist entry points share search and multiline direct editing while their action buttons differ', () => {
  for (const mode of ['project', 'general', 'claim', 'new-claim']) {
    const h = harness({ mode });
    assert.equal(h.search.type, 'search'); assert.equal(h.searchRoot.dataset.checklistSearch, '');
    const text = editor(h.rows()[0]);
    assert.equal(text.tag, 'textarea'); assert.equal(text.disabled, false); assert.equal(text.rows, 1); assert.equal(text.maxLength, 5000);
    assert.deepEqual(h.rows()[0].children.filter(node => node.tag === 'button').map(node => node.textContent), mode === 'claim' || mode === 'new-claim' ? ['领取'] : mode === 'general' ? ['指派会话', '删除'] : ['删除']);
    assert.deepEqual(h.rows().map(row => editor(row).value), [early.text, later.text]);
  }
});

test('checklist controls use monochrome SVG icons and a clear hierarchy, while both claim views hide add', () => {
  const source = buildNativeProjectChecklistScript();
  assert.match(source, /encodeURIComponent/);
  assert.match(source, /M12 5v14M5 12h14/);
  assert.match(source, /<circle cx="11" cy="11" r="7"\/>/);
  assert.doesNotMatch(source, /🔍|＋/);
  assert.match(source, /\[data-checklist-controls\] p\{order:1\}/);
  assert.match(source, /form\{order:2\}/);
  assert.match(source, /\[data-checklist-search\]\{order:3\}/);
  for (const mode of ['project', 'general', 'claim', 'new-claim']) {
    const h = harness({ mode }), form = h.dialog.children[2], controls = h.dialog.children[1];
    assert.equal(controls.children[1], h.searchRoot);
    assert.equal(h.dialog.children[0].children.length, 2);
    assert.equal(form.hidden, mode === 'claim' || mode === 'new-claim');
    assert.equal(h.dialog.dataset.claim, String(form.hidden));
    assert.match(h.document.head.children[0].textContent, /data:image\/svg\+xml,/);
  }
  const h = harness({ mode: 'claim' });
  h.api.openGeneral(); assert.equal(h.dialog.children[2].hidden, false);
  h.api.openClaimableForNewThread(); assert.equal(h.dialog.children[2].hidden, true);
  h.query('alpha'); assert.equal(h.visible().length, 1);
});

test('task cards start at one text line while multiline content and initial time stay intact', () => {
  const source = buildNativeProjectChecklistScript();
  assert.match(source, /width:min\(760px,calc\(100vw - 40px\)\)/);
  assert.match(source, /field-sizing:content;min-height:34px;max-height:128px/);
  assert.match(source, /gap:4px 10px;padding:7px 9px/);
  assert.match(source, /\[data-checklist-added\]\{order:-1;flex:none;margin-inline-end:8px;white-space:nowrap/);
  assert.doesNotMatch(source, /\[data-checklist-added\]\{flex-basis:100%/);
  const multiline = { ...early, text: '第一行\n第二行' };
  const h = harness({ mode: 'claim', items: [multiline] }), row = h.rows()[0], text = editor(row);
  assert.equal(text.rows, 1);
  assert.equal(text.value, '第一行\n第二行');
  assert.equal(row.children.at(-1).attrs.datetime, multiline.createdAt);
});

test('visible task rows are numbered before the date without changing task identity', () => {
  const source = buildNativeProjectChecklistScript();
  assert.match(source, /padding-inline-start:48px;[^}]*gap:5px;counter-reset:task/);
  assert.match(source, /li\[data-checklist-row\]\{counter-increment:task;position:relative\}/);
  assert.match(source, /content:counter\(task\);position:absolute;inset-inline-start:-44px/);
  assert.match(source, /width:32px;height:34px;border-radius:9px;background:#8882/);
  assert.match(source, /\[data-checklist-added\]\{order:-1/);
  const h = harness({ mode: 'claim' });
  assert.equal(h.rows().length, 2);
  assert.ok(h.rows().every(row => row.attrs['data-checklist-row'] === ''));
  h.query('alpha'); assert.equal(h.visible().length, 1);
  assert.equal(h.visible()[0].attrs['data-checklist-row'], '');
  const empty = harness({ mode: 'claim', items: [] });
  assert.equal(empty.list.children[0].attrs['data-checklist-row'], undefined);
});

test('claim button occupies its own card outside the task row while keeping the same action node', () => {
  const h = harness({ mode: 'claim' }), row = h.rows()[0], source = buildNativeProjectChecklistScript();
  assert.equal(row.attrs['data-checklist-claim-row'], '');
  assert.equal(button(row, '领取').parent, row);
  assert.match(source, /\[data-claim=true\] ul\{padding-inline-end:88px\}/);
  assert.match(source, /li\[data-checklist-claim-row\]>button\{position:absolute;inset-inline-end:-76px/);
  assert.match(source, /width:64px;height:34px/);
  assert.equal(harness({ mode: 'general' }).rows()[0].attrs['data-checklist-claim-row'], undefined);
});

test('task rows use soft surfaces without stacked resting borders and retain keyboard focus cues', () => {
  const h = harness({ mode: 'claim' }), style = h.document.head.children[0].textContent;
  assert.match(style, /form,\[data-ccc-checklist\] \[data-checklist-search\]\{[^}]*border:0/);
  assert.match(style, /textarea\{[^}]*background:transparent/);
  assert.match(style, /textarea:focus-visible\{outline:1px solid/);
  assert.match(style, /li\{[^}]*border:0;border-radius/);
  assert.match(style, /button\{cursor:pointer;border:0/);
});

test('search matches trimmed case-insensitive content without replacing rows, saving or changing time order', () => {
  for (const mode of ['project', 'general', 'claim']) {
    const h = harness({ mode }), rows = h.rows(), text = editor(rows[0]);
    text.value = 'Alpha 中文任务，尚未保存';
    h.query('  aLPHA  ');
    assert.deepEqual(h.visible(), [rows[0]]); assert.match(h.searchRoot.children.at(-1).textContent, /1/);
    h.query('中文'); assert.deepEqual(h.visible(), [rows[0]]);
    h.query('完全不存在'); assert.equal(h.visible().length, 0);
    assert.equal(h.searchRoot.children.at(-1).textContent, '没有匹配的任务');
    click(h.searchRoot, '清空');
    assert.equal(h.search.value, ''); assert.deepEqual(h.visible(), rows); assert.equal(editor(rows[0]), text);
    assert.equal(text.value, 'Alpha 中文任务，尚未保存'); assert.equal(rows[0].children.at(-1).attrs.datetime, early.createdAt);
    assert.equal(h.api.packet().actions.length, 0);
  }
});

test('general search includes lower assigned and held todos but claim search cannot reveal them or completed tasks', () => {
  const assigned = { ...early, id: 'assigned', text: '会话专属标记', assignedThreadId: threadB };
  const completed = { ...early, id: 'done', text: '已完成专属标记', done: true };
  const held = [{ id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', summary: '本地直存专属标记', heldAt: 1, origin: 'draft' }];
  const general = harness({ items: [early, assigned, completed], held });
  general.idle.splice(0).forEach(fn => fn());
  for (const query of ['会话专属', '本地直存']) { general.query(query); assert.equal(general.visible().length, 1); }
  const claim = harness({ mode: 'claim', items: [early, assigned, completed], held });
  assert.equal(claim.idle.length, 0); assert.equal(claim.rows().length, 1);
  for (const query of ['会话专属', '本地直存', '已完成专属']) { claim.query(query); assert.equal(claim.visible().length, 0); }
  const newClaim = harness({ mode: 'new-claim', items: [early, assigned, completed], held });
  assert.equal(newClaim.idle.length, 0); assert.equal(newClaim.rows().length, 1);
  assert.match(button(newClaim.rows()[0], '领取').title, /发送/);
  assert.equal(general.api.packet().actions.length, 0); assert.equal(claim.api.packet().actions.length, 0);
});

test('search Enter only prevents submission and reopening or changing panels resets the filter', () => {
  const h = harness(); h.query('alpha');
  let prevented = false;
  h.search.listeners.keydown({ key: 'Enter', preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(h.api.packet().actions.length, 0);
  h.api.openGeneral(); assert.equal(h.search.value, ''); assert.equal(h.visible().length, 2);
  h.query('beta'); h.api.openClaimableForCurrentThread(threadA);
  assert.equal(h.search.value, ''); assert.equal(h.visible().length, 2);
  h.query('alpha'); h.api.open({ key: 'project-b' });
  assert.equal(h.search.value, '');
});

test('background updates retain search, unsaved draft, focus and selection in general and claim modes', () => {
  for (const mode of ['general', 'claim']) {
    const h = harness({ mode, items: [early] }), row = h.rows()[0], text = editor(row);
    text.value = 'Alpha 未保存草稿'; text.focus(); text.setSelectionRange(3, 7); h.query('alpha');
    h.accept([early, later]);
    const restored = editor(h.rows()[0]);
    assert.equal(h.search.value, 'alpha'); assert.equal(h.visible().length, 1); assert.equal(restored.value, text.value);
    assert.equal(h.document.activeElement, restored); assert.equal(restored.selectionStart, 3); assert.equal(restored.selectionEnd, 7);
    assert.equal(h.api.packet().actions.length, 0); click(h.searchRoot, '清空'); assert.equal(h.visible().length, 2);
  }
});

test('assignment confirms the latest textarea content both before and after opening the conversation picker', () => {
  for (const editAfterOpening of [false, true]) {
    const h = harness({ items: [early] }), row = h.rows()[0], text = editor(row);
    text.value = '打开指派前的修改'; click(row, '指派会话');
    if (editAfterOpening) text.value = '打开指派后再修改\n仍使用框内内容';
    find(row, node => node.tag === 'select').value = threadA; click(row, '确认');
    const actions = h.api.packet().actions, assigned = actions.at(-1);
    assert.equal(assigned.text, text.value); assert.equal(assigned.assignedThreadId, threadA); assert.equal(assigned.id, early.id);
    assert.equal(assigned.createdAt, early.createdAt); assert.equal(assigned.done, false);
  }
});

test('autosave does not replace an open assignment picker or consume the following confirm click', () => {
  const h = harness({ items: [early] }), row = h.rows()[0], text = editor(row);
  click(row, '指派会话');
  const select = find(row, node => node.tag === 'select'), confirm = button(row, '确认');
  select.value = threadA; text.value = '选择会话期间自动保存'; text.listeners.change();
  assert.equal(h.rows()[0], row); assert.equal(find(row, node => node.tag === 'select'), select); assert.equal(button(row, '确认'), confirm);
  text.value = '最终指派内容'; confirm.listeners.click();
  assert.equal(h.api.packet().actions.at(-1).text, '最终指派内容');
  assert.equal(h.api.packet().actions.at(-1).assignedThreadId, threadA);
});

test('the common editor rejects invalid saves and assignment without discarding the input', () => {
  for (const invalid of ['   ', 'x'.repeat(5001)]) {
    const h = harness({ items: [early] }), row = h.rows()[0], text = editor(row);
    text.value = invalid; text.listeners.change();
    assert.equal(h.api.packet().actions.length, 0); assert.equal(text.value, invalid);
    click(row, '指派会话'); assert.equal(find(row, node => node.tag === 'select'), undefined);
    text.value = '先填有效内容'; click(row, '指派会话');
    text.value = invalid; find(row, node => node.tag === 'select').value = threadA; click(row, '确认');
    assert.equal(h.api.packet().actions.length, 0); assert.equal(text.value, invalid);
    assert.match(h.status(), /不能为空|5000/);
  }
});

test('general editor and assignment callbacks from a previous panel cannot mutate the newly opened project', () => {
  const h = harness({ items: [early] }), row = h.rows()[0], text = editor(row);
  click(row, '指派会话'); const confirm = button(row, '确认');
  find(row, node => node.tag === 'select').value = threadA; text.value = '陈旧内容';
  h.api.open({ key: 'other-project' });
  text.listeners.change(); confirm.listeners.click();
  assert.equal(h.api.packet().actions.length, 0);
});

test('general background task changes preserve a local draft without permitting a stale overwrite', () => {
  const h = harness({ items: [early] }), text = editor(h.rows()[0]);
  text.value = 'Alpha 本地未保存版本'; h.query('alpha');
  h.accept([{ ...early, text: 'Alpha 外部修改版本' }, later]);
  const row = h.rows()[0], restored = editor(row);
  assert.equal(restored.value, text.value); restored.listeners.change();
  click(row, '指派会话'); assert.equal(find(row, node => node.tag === 'select'), undefined);
  assert.equal(h.api.packet().actions.length, 0); assert.match(h.status(), /状态已变化|任务已变化|已被修改/);
});
