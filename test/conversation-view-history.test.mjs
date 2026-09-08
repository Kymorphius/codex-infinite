import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createConversationViewHistory } from '../src/conversation-view-history.mjs';
import { buildNativeConversationTabsInjectionSource } from '../src/native-conversation-tabs.mjs';
const first = { id: '01a065ff-1594-7e41-8163-44edff7ba28b', title: 'First', kind: 'local' };
const second = { ...first, id: '01a05852-9f3a-77b2-8ad3-74aa8e49c7c3', title: 'Second' };
test('view history orders by actual view time, deduplicates and persists acknowledgement revisions', () => {
  const history = createConversationViewHistory();
  const current = { ...first, projectLabel: 'Project', updatedAt: '2026-09-06T01:00:00Z' };
  history.view(first, Date.parse('2026-09-06T02:00:00Z'), current);
  history.view(second, Date.parse('2026-09-06T03:00:00Z'));
  assert.deepEqual(history.list().map(x => x.id), [second.id, first.id]);
  history.view(first, Date.parse('2026-09-06T04:00:00Z'), current);
  const restored = createConversationViewHistory(history.list());
  assert.deepEqual(restored.list().map(x => x.id), [first.id, second.id]);
  assert.equal(restored.list()[0].projectLabel, 'Project');
  assert.ok(restored.hasViewed(current));
  assert.equal(restored.hasViewed({ ...current, updatedAt: '2026-09-06T05:00:00Z' }), false);
});
test('view history rejects corrupt state and bounds retention', () => {
  assert.deepEqual(createConversationViewHistory({}).list(), []);
  assert.deepEqual(createConversationViewHistory([null, { id: 'bad', viewedAt: 5 }, { ...first, viewedAt: NaN }]).list(), []);
  const history = createConversationViewHistory();
  for (let i = 0; i < 220; i++) history.view({ ...first, id: String(i).padStart(8, '0') + first.id.slice(8) }, i + 1);
  assert.equal(history.list().length, 200); assert.equal(history.list()[0].viewedAt, 220);
  assert.equal(history.view({ id: 'bad' }, 999), false);
});
test('production tab open and activate notify views; background title synchronization does not', () => {
  const source = buildNativeConversationTabsInjectionSource();
  const open = source.slice(source.indexOf('    function open('), source.indexOf('    function showConsole('));
  const activate = source.slice(source.indexOf('    function activate('), source.indexOf('    function adjacentKey('));
  const views = [], routes = [];
  const context = vm.createContext({ normalizeTab: x => x, keyFor: x => x.id, state: { tabs: [], activeKey: 'console' }, render() {},
    window: { __codexControlConsoleAttentionConversations: { view: x => views.push(x.id) } }, options: { openLocal: x => routes.push(x.id) } });
  vm.runInContext(open + activate, context);
  context.open(first, true, true); context.open({ ...first, title: 'Updated' }); context.open(first);
  assert.deepEqual(views, [first.id]);
  context.open(second, true, true); context.activate(first.id); context.open(first, true, true);
  assert.deepEqual(views, [first.id, second.id, first.id, first.id]); assert.deepEqual(routes, [first.id]);
  assert.match(source, /openLocal: \(tab\) => open\(\{ \.\.\.tab, kind: 'local' \}, true, true\)/);
  assert.match(source, /title: localTitle\(selected\) \}, true, Boolean\(row\)\)/);
});

test('missing completion timestamps still acknowledge the exact observed item', () => {
  const history = createConversationViewHistory();
  history.view(first, 1000, { ...first, updatedAt: '' });
  assert.equal(history.hasViewed({ ...first, updatedAt: '' }), true);
  assert.equal(history.hasViewed({ ...first, updatedAt: '2026-09-06T05:00:00Z' }), false);
});
