import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeDiscussionPairs, createNativeTerminalSidebar } from '../src/native-terminal-sidebar.mjs';
import { buildNativeTerminalProviderSource } from '../src/native-terminal-provider.mjs';

const GPT = '01a0be7e-3c97-76a3-b5da-36c782facc71', CLAUDE = '3f610a4b-8878-4713-a824-788bbfce53fb', CLAUDE_2 = '5a0d0f3e-1111-4222-8333-444455556666';
const discussion = (claude, gpt, extra = {}) => ({ id: 'd-' + claude.slice(0, 4), status: 'running', round: 2, participants: [{ role: 'claude', conversationId: claude }, { role: 'gpt', conversationId: gpt }], ...extra });

function node(attributes = {}) {
  return { attributes, dataset: {}, style: {}, children: [], parentElement: null, textContent: '',
    getAttribute(key) { return this.attributes[key] ?? null; }, setAttribute(key, value) { this.attributes[key] = value; },
    append(...values) { for (const value of values) { value.remove?.(); value.parentElement = this; this.children.push(value); } },
    insertBefore(value, before) { value.remove?.(); value.parentElement = this; const index = this.children.indexOf(before); if (index < 0) this.children.push(value); else this.children.splice(index, 0, value); },
    get nextSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1] || null; },
    get previousElementSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) - 1] || null; },
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(value => value !== this); this.parentElement = null; },
    addEventListener() {} };
}
const claudeRecord = (id, extra = {}) => ({ id, provider: 'terminal', deviceId: 'd', kind: 'claude', title: 'Claude ' + id.slice(0, 4), cwd: '/c', revision: 1, projectRef: null, pinned: false, archived: false, ...extra });

function setup() {
  const list = node(), item = node({ role: 'listitem' }), wrapper = node(), row = node({ 'data-app-action-sidebar-thread-id': 'local:' + GPT }), next = node({ role: 'listitem' });
  wrapper.append(row); item.append(wrapper); list.append(item, next);
  let rows = [row]; const opened = [], tasks = node();
  const documentRef = { head: node(), createElement: () => node(),
    querySelector: selector => rows.find(value => selector === '[data-app-action-sidebar-thread-id="' + value.attributes['data-app-action-sidebar-thread-id'] + '"]') || null };
  const sidebar = createNativeTerminalSidebar({ documentRef, readModel: () => ({ sections: [{ kind: 'tasks', node: { parentElement: tasks } }] }), open: value => opened.push(value), menu() {}, storage: null });
  return { list, next, tasks, opened, sidebar, hideGpt() { rows = []; } };
}

test('pairs come from live discussions only, one per Claude conversation, and tolerate junk', () => {
  const pairs = nativeDiscussionPairs([discussion(CLAUDE, GPT), discussion(CLAUDE_2, GPT, { status: 'stopped' }), discussion(CLAUDE, 'other-gpt'),
    null, { participants: 'x' }, { status: 'idle', participants: [{ role: 'claude', conversationId: 'only' }] }]);
  assert.deepEqual([...pairs], [[CLAUDE, { id: 'd-3f61', gptId: GPT, round: 2 }]]);
  assert.equal(nativeDiscussionPairs(undefined).size, 0);
});

test('a paired Claude is always expanded right under its GPT row, with a badge and a gutter marker that opens it', () => {
  const { list, next, opened, sidebar } = setup(), record = claudeRecord(CLAUDE);
  sidebar.render([record], '', nativeDiscussionPairs([discussion(CLAUDE, GPT)]));
  const root = list.children[1];
  assert.equal(root.dataset.cccTerminalSidebar, CLAUDE, 'directly after the GPT item, before the next thread'); assert.equal(list.children[2], next);
  assert.equal(root.dataset.companionThread, GPT);
  const [marker, claudeRow] = root.children;
  assert.equal(marker.dataset.pairMarker, ''); assert.match(marker.attributes['aria-label'], /已转发 2 次/);
  assert.equal(claudeRow.dataset.paired, 'true'); assert.equal(claudeRow.dataset.companion, 'true');
  const button = claudeRow.children[0];
  assert.equal(button.children[0].textContent, '↳'); assert.equal(button.children.at(-1).textContent, '⇄ 2');
  marker.onclick({ preventDefault() {}, stopPropagation() {} }); button.onclick();
  assert.deepEqual(opened, [record, record]);
});

test('several Claude conversations under one GPT share a single marker', () => {
  const { list, sidebar } = setup();
  sidebar.render([claudeRecord(CLAUDE), claudeRecord(CLAUDE_2)], '', nativeDiscussionPairs([discussion(CLAUDE, GPT), discussion(CLAUDE_2, GPT, { round: 0 })]));
  const roots = list.children.filter(value => value.dataset?.cccTerminalSidebar);
  assert.equal(roots.length, 2);
  assert.equal(roots.flatMap(root => root.children).filter(value => 'pairMarker' in value.dataset).length, 1);
});

test('unpairing, a hidden GPT row, or a companion leave the normal placement alone', () => {
  const unpaired = setup(); unpaired.sidebar.render([claudeRecord(CLAUDE)], '', nativeDiscussionPairs([discussion(CLAUDE, GPT)]));
  unpaired.sidebar.render([claudeRecord(CLAUDE)], '', nativeDiscussionPairs([discussion(CLAUDE, GPT, { status: 'stopped' })]));
  assert.equal(unpaired.list.children.length, 2, 'removed from under the GPT row'); assert.equal(unpaired.tasks.children[0].dataset.cccTerminalSidebar, CLAUDE);
  const hidden = setup(); hidden.hideGpt(); hidden.sidebar.render([claudeRecord(CLAUDE)], '', nativeDiscussionPairs([discussion(CLAUDE, GPT)]));
  assert.equal(hidden.list.children.length, 2); assert.equal(hidden.tasks.children[0].dataset.cccTerminalSidebar, CLAUDE);
  assert.equal(hidden.tasks.children[0].children[0].dataset.paired, undefined, 'not marked paired where it is not under its GPT');
  const companion = setup(); companion.sidebar.render([claudeRecord(CLAUDE, { companionOf: GPT })], '', nativeDiscussionPairs([discussion(CLAUDE, 'someone-else')]));
  assert.equal(companion.list.children[1].children[0].dataset.companionToggle, '', 'a Router companion keeps its own disclosure');
});

test('re-rendering with a changed round updates the badge', () => {
  const { list, sidebar } = setup(), record = claudeRecord(CLAUDE);
  sidebar.render([record], '', nativeDiscussionPairs([discussion(CLAUDE, GPT, { round: 1 })]));
  sidebar.render([record], '', nativeDiscussionPairs([discussion(CLAUDE, GPT, { round: 3 })]));
  assert.equal(list.children[1].children[1].children[0].children.at(-1).textContent, '⇄ 3');
});

test('the injected provider source ships the pair helper and reads pairs through the discussion bridge', () => {
  const source = buildNativeTerminalProviderSource();
  assert.match(source, /function nativeDiscussionPairs/);
  assert.match(source, /__cccDiscussions\?\.request\('list'\)/);
  assert.match(source, /sidebar\.render\(records, active\?\.kind === 'terminal' \? active\.id : '', pairs\)/);
});
