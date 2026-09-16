import test from 'node:test';
import assert from 'node:assert/strict';
import { readNativeSidebarModel, projectNativeSidebarModel } from '../src/native-sidebar-model.mjs';
test('snapshot reads committed fibers even when a DOM fiber points to old props', () => {
  const node = {}, scope = { get() {}, set() {}, query: {}, node: {}, scope: {} };
  const list = { projectByKey: new Map([['codex:project:p', { source: 'codex', group: { projectId: 'p', label: 'Empty', rootPaths: [], threadKeys: [] } }]]), conversationByKey: new Map(), keys: ['codex:project:p'] };
  const props = { sectionKey: 'threads', heading: 'Projects', collapsed: true, onCollapsedChange() {}, children: { props: list } };
  const root = { stateNode: {} }, owner = { memoizedProps: props, return: root, updateQueue: { memoCache: { data: [[scope]] } } }, leaf = { stateNode: node, return: owner };
  root.child = owner; owner.child = leaf; root.stateNode.current = root;
  const staleRoot = { stateNode: root.stateNode }, stale = { stateNode: node, return: staleRoot, memoizedProps: { heading: 'old' } }; node.__reactFiberTest = stale;
  const model = readNativeSidebarModel({ querySelectorAll: () => [{}, node] });
  assert.equal(model.scope, scope); assert.equal(model.sections[0].collapsed, true);
  const snapshot = projectNativeSidebarModel(model); assert.equal(snapshot.projects[0].name, 'Empty'); assert.deepEqual(snapshot.projects[0].conversationKeys, []);
  assert.deepEqual(snapshot.sections.find(section => section.id === 'threads').itemKeys, ['codex:project:p']);
});

test('explicit reveal uses native visibility buttons and leaves data controls untouched', async () => {
  const { revealNativeSidebar } = await import('../src/native-sidebar-visibility.mjs');
  const vm = await import('node:vm'); const clicked = [];
  const buttons = ['显示侧边栏', '关闭活动视图', '删除项目'].map(label => ({ getAttribute: () => label, click: () => clicked.push(label) }));
  vm.runInNewContext(`(${revealNativeSidebar.toString()})()`, { document: { querySelectorAll: () => buttons } });
  assert.deepEqual(clicked, ['显示侧边栏', '关闭活动视图']);
});
