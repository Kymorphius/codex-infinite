import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createChecklistSearch } from '../src/native-checklist-search.mjs';

function harness() {
  const writes = [];
  class Node {
    constructor(tag) {
      this.tag = tag; this.children = []; this.dataset = {}; this.attrs = {}; this.listeners = {};
      this.value = ''; this._hidden = false; this._text = ''; this.focused = false;
    }
    set hidden(value) { writes.push([this, 'hidden', value]); this._hidden = value; }
    get hidden() { return this._hidden; }
    set textContent(value) { writes.push([this, 'textContent', value]); this._text = value; }
    get textContent() { return this._text; }
    append(...nodes) { this.children.push(...nodes); }
    setAttribute(key, value) { this.attrs[key] = value; }
    addEventListener(name, handler) { this.listeners[name] = handler; }
    focus() { this.focused = true; }
  }
  const make = (tag, text) => { const node = new Node(tag); if (text) node.textContent = text; return node; };
  // Production serializes this helper into the native page: it must have no module dependencies.
  const create = vm.runInNewContext('(' + createChecklistSearch.toString() + ')');
  const search = create(make), [input, clear, result] = search.root.children;
  const list = make('ul');
  function row(text) {
    const node = make('li'), field = make('input'); field.value = text; node.append(field); list.append(node);
    search.register(node, () => field.value);
    return { node, field };
  }
  return { search, input, clear, result, row, list, writes, query(text) { input.value = text; input.listeners.input(); } };
}

test('search is accessible and matches Chinese, mixed case and trimmed queries', () => {
  const h = harness(), a = h.row('任务 Alpha'), b = h.row('记录 beta'), c = h.row('任务 ALPHABET');
  assert.equal(h.search.root.dataset.checklistSearch, '');
  assert.equal(h.input.type, 'search'); assert.equal(h.input.attrs['aria-label'], '搜索任务');
  assert.equal(h.clear.type, 'button'); assert.equal(h.result.attrs['aria-live'], 'polite');
  h.query('  aLpHa  ');
  assert.deepEqual([a.node.hidden, b.node.hidden, c.node.hidden], [false, true, false]);
  assert.equal(h.result.textContent, '匹配 2 项'); assert.equal(h.clear.hidden, false);
  h.query('记录');
  assert.deepEqual([a.node.hidden, b.node.hidden, c.node.hidden], [true, false, true]);
  assert.equal(h.result.textContent, '匹配 1 项');
});

test('no results and whitespace queries report correctly without changing row order', () => {
  const h = harness(), a = h.row('早任务'), b = h.row('晚任务'), original = [...h.list.children];
  h.query('不存在');
  assert.equal(h.result.textContent, '没有匹配的任务'); assert.equal(a.node.hidden, true); assert.equal(b.node.hidden, true);
  h.query(' \n\t ');
  assert.equal(h.result.textContent, ''); assert.equal(h.clear.hidden, true);
  assert.equal(a.node.hidden, false); assert.equal(b.node.hidden, false);
  assert.deepEqual(h.list.children, original);
});

test('clear restores all rows and their same draft fields without rebuilding UI', () => {
  const h = harness(), a = h.row('最初文本'), b = h.row('保留任务');
  a.field.value = '还没保存的草稿';
  const controls = [...h.search.root.children], original = [...h.list.children];
  h.query('保留任务'); assert.equal(a.node.hidden, true);
  h.clear.listeners.click();
  assert.equal(h.input.value, ''); assert.equal(h.input.focused, true);
  assert.equal(a.node.hidden, false); assert.equal(b.node.hidden, false);
  assert.equal(a.field.value, '还没保存的草稿'); assert.equal(a.node.children[0], a.field);
  assert.deepEqual(h.list.children, original); assert.deepEqual(h.search.root.children, controls);
  assert.equal(h.result.textContent, ''); assert.equal(h.clear.hidden, true);
});

test('matching uses the editable field current content on every input', () => {
  const h = harness(), a = h.row('旧文本');
  h.query('新内容'); assert.equal(a.node.hidden, true);
  a.field.value = '新的新内容'; h.input.listeners.input();
  assert.equal(a.node.hidden, false); assert.equal(h.result.textContent, '匹配 1 项');
  h.query('旧文本'); assert.equal(a.node.hidden, true);
});

test('repeated equivalent filtering is idempotent and writes only changed attributes', () => {
  const h = harness(), a = h.row('Alpha'), b = h.row('Beta');
  h.writes.length = 0; h.search.apply(); assert.equal(h.writes.length, 0);
  h.query('alpha');
  assert.deepEqual(h.writes.map(([, key]) => key), ['hidden', 'textContent', 'hidden']);
  assert.equal(h.writes[0][0], b.node);
  h.writes.length = 0; h.query(' ALPHA '); h.search.apply();
  assert.equal(h.writes.length, 0); assert.equal(a.node.hidden, false);
});

test('resetting registered rows preserves query and only filters the new scope', () => {
  const h = harness(), old = h.row('匹配旧任务'); h.query('匹配');
  h.search.resetRows();
  const a = h.row('当前任务'), b = h.row('匹配当前任务');
  h.writes.length = 0; h.search.apply();
  assert.equal(h.input.value, '匹配'); assert.equal(a.node.hidden, true); assert.equal(b.node.hidden, false);
  assert.equal(h.result.textContent, '匹配 1 项');
  assert.equal(h.writes.some(([node]) => node === old.node), false);
});

test('panel reset clears the query and restores registered rows', () => {
  const h = harness(), row = h.row('任务'); h.query('不匹配');
  h.search.reset();
  assert.equal(h.input.value, ''); assert.equal(row.node.hidden, false);
  assert.equal(h.result.textContent, ''); assert.equal(h.clear.hidden, true);
  assert.equal(h.input.focused, false, 'panel reset does not steal focus');
});

test('Enter prevents a form submission and other keys remain available', () => {
  const h = harness(); let prevented = 0;
  h.input.listeners.keydown({ key: 'Enter', preventDefault() { prevented++; } });
  assert.equal(prevented, 1);
  h.input.listeners.keydown({ key: 'a', preventDefault() { prevented++; } });
  assert.equal(prevented, 1);
});
