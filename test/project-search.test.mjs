import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildProjectSearchCatalog, filterProjectNames } from '../src/project-search.mjs';
import { buildNativeProjectSearchInjectionScript, buildNativeProjectSearchSnapshotScript } from '../src/native-project-search.mjs';
const id = '01a04cd6-8d30-78f1-b2a7-f760d148f744';
test('project search matches Chinese, partial names and case/full-width variants while preserving catalog order', () => {
  const projects = [{ name: 'WorldManager' }, { name: '新项目管理' }, { name: 'world工具' }];
  assert.deepEqual(filterProjectNames(projects, ' ＷＯＲＬＤ '), [projects[0], projects[2]]);
  assert.deepEqual(filterProjectNames(projects, '项目'), [projects[1]]);
  assert.deepEqual(filterProjectNames(projects, ' '), []);
  assert.deepEqual(filterProjectNames(projects, '不存在'), []);
});
test('catalog includes empty/categorized projects, deduplicates tasks and never substitutes task cwd for project roots', () => {
  const task = { id, title: '查看结果', cwd: '/private', sourceFile: '/private/log' };
  const catalog = buildProjectSearchCatalog([{ project: { id: 'a', name: '项目甲', cwd: '/private' } }, { project: { id: 'b', name: '空项目' } }], [task, task, { ...task, id: 'invalid' }], () => ({ id: 'a' }));
  assert.deepEqual(catalog, [{ id: 'a', name: '项目甲', sourceDirectory: null, sourceDirectories: [], tasks: [{ id, title: '查看结果' }] }, { id: 'b', name: '空项目', sourceDirectory: null, sourceDirectories: [], tasks: [] }]);
});
test('standalone injection compiles and snapshot escapes markup without altering search text', () => {
  new vm.Script(buildNativeProjectSearchInjectionScript());
  const value = { projects: [{ name: '<项目>', tasks: [] }], stale: false }; let received;
  const script = buildNativeProjectSearchSnapshotScript(value);
  assert.equal(script.includes('<项目>'), false);
  vm.runInNewContext(script, { window: { __codexControlConsoleProjectSearch: { set(v) { received = v; } } } });
  assert.equal(received.projects[0].name, '<项目>');
});

test('search input updates results, expands matching project, preserves focus and clears without touching native rows', () => {
  class Node {
    constructor(tag) { this.tag = tag; this.tagName = tag; this.children = []; this.attrs = {}; this.style = {}; this.listeners = {}; }
    append(...nodes) { for (const node of nodes) { this.children.push(node); node.parentElement = this; } }
    insertBefore(node, before) { this.children.splice(this.children.indexOf(before), 0, node); node.parentElement = this; }
    remove() { this.parentElement?.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null; }
    setAttribute(k, v) { this.attrs[k] = v; }
    getAttribute(k) { return this.attrs[k] ?? null; }
    get attributes() { return Object.entries(this.attrs).map(([name, value]) => ({ name, value })); }
    addEventListener(k, fn) { this.listeners[k] = fn; }
    replaceChildren() { this.children = []; }
    focus() { this.focused = true; }
  }
  const parent = new Node(), wrapper = new Node(), native = new Node(); parent.append(wrapper); wrapper.append(native);
  const nativeProject = new Node('div'), nativeThread = new Node('div'), nativeIcon = new Node('svg'), nativeLabel = new Node('span');
  native.className = 'relative px-row-x';
  nativeProject.className = 'group sidebar-item h-native hover:native bg-primary-ghost-hover';
  nativeThread.className = 'sidebar-item native-thread-height'; nativeLabel.className = 'text-base native-label';
  nativeIcon.setAttribute('viewBox', '0 0 16 16'); nativeIcon.setAttribute('id', 'native-owned');
  const path = new Node('path'); path.setAttribute('d', 'M1 2'); path.setAttribute('onclick', 'unsafe'); nativeIcon.append(path);
  nativeIcon.append(new Node('script'));
  nativeProject.querySelector = () => nativeLabel;
  const walk = node => [node, ...node.children.flatMap(walk)];
  const nativeTarget = new Node('button'); nativeTarget.setAttribute('data-app-action-sidebar-thread-id', 'local:' + id);
  let revealed = 0; nativeTarget.scrollIntoView = options => { revealed++; nativeTarget.revealOptions = options; };
  const nativeTargetProject = new Node('div'); nativeTargetProject.setAttribute('data-app-action-sidebar-project-id', 'mapped-project'); nativeTargetProject.setAttribute('data-app-action-sidebar-project-collapsed', 'true');
  let nativeProjectExpanded = 0; nativeTargetProject.click = () => { nativeProjectExpanded++; nativeTargetProject.setAttribute('data-app-action-sidebar-project-collapsed', 'false'); };
  const context = vm.createContext({ document: { documentElement: parent, querySelector: selector => selector.startsWith('section') ? native : selector.includes('project-collapsed') ? nativeIcon : selector.includes('project-id') ? nativeProject : selector.includes('thread-row') ? nativeThread : null, querySelectorAll: selector => selector === '[data-app-action-sidebar-project-id]' ? [nativeTargetProject] : selector === '[data-app-action-sidebar-thread-id]' ? [nativeTarget] : [], createElement: tag => new Node(tag), createElementNS: (_, tag) => new Node(tag) },
    window: {}, MutationObserver: class { observe() {} disconnect() {} }, requestAnimationFrame: fn => fn(), setTimeout: fn => { fn(); return 1; } });
  vm.runInContext(buildNativeProjectSearchInjectionScript(), context);
  vm.runInContext(buildNativeProjectSearchSnapshotScript({ projects: [{ id: 'p', name: 'Tokens', tasks: [{ id, title: '会话' }] }], stale: false }), context);
  const input = walk(parent).find(n => n.tag === 'input');
  input.value = 'TOK'; input.listeners.input();
  const result = walk(parent).find(n => n.attrs['data-project-search-id'] === 'p'); assert.ok(result);
  const created = []; context.window.__cccProjectSearchActions.create = project => created.push(project.id);
  let stopped = false;
  walk(result).find(n => n.attrs['data-project-search-create']).listeners.click({ stopPropagation() { stopped = true; } });
  assert.deepEqual(created, ['p']); assert.equal(stopped, true); assert.equal(result.attrs['aria-expanded'], 'false');
  assert.match(result.className, /h-native hover:native/); assert.doesNotMatch(result.className, /bg-primary-ghost-hover/);
  assert.equal(parent.children[0].className, 'relative px-row-x py-1');
  const copiedIcon = walk(result).find(n => n.tag === 'svg'); assert.equal(copiedIcon.attrs.viewBox, '0 0 16 16');
  assert.equal(copiedIcon.attrs.id, undefined); assert.equal(copiedIcon.children[0].attrs.onclick, undefined);
  assert.equal(copiedIcon.children.length, 1); assert.ok(walk(result).some(n => n.className === 'text-base native-label'));
  result.listeners.click(); assert.ok(walk(parent).some(n => n.textContent === '会话'));
  const taskRow = walk(parent).find(n => n.attrs['data-project-search-thread-id'] === id);
  assert.match(taskRow.className, /native-thread-height/); assert.match(taskRow.style.paddingInlineStart, /24px/);
  nativeProject.className = 'sidebar-item updated-native-height';
  context.window.__codexControlConsoleProjectSearch.set({ projects: [{ id: 'p', name: 'Tokens', tasks: [{ id, title: '会话' }] }], stale: false });
  assert.match(walk(parent).find(n => n.attrs['data-project-search-id']).className, /updated-native-height/);
  assert.equal(input.value, 'TOK');
  assert.equal(walk(parent).find(n => n.tag === 'input'), input);
  const opened = [], localRoutes = [], activation = [];
  context.window.__codexControlConsoleClose = () => activation.push('restore');
  context.window.__codexControlConsoleConversationTabs = { openLocal: task => activation.push('tab:' + task.id) };
  context.window.__codexControlConsoleOpenRemoteConversation = reference => opened.push(reference);
  context.window.postMessage = message => { activation.push('route'); localRoutes.push(message.path); };
  context.window.__codexControlConsoleProjectSearch.set({ stale: false, projects: [
    { id: 'same', checklistKey: 'mapped-project', searchKey: 'local-key', name: 'Tokens', tasks: [{ id, title: '本机会话' }] },
    { id: 'same', searchKey: 'win-key', name: 'Tokens', sourceDirectory: 'D:\\Tokens', device: { id: 'win', kind: 'remote-codex', name: 'Windows', status: 'connected' }, tasks: [{ id, title: 'Windows 会话' }] },
    { id: 'same', searchKey: 'offline-key', name: 'Tokens', device: { id: 'offline', kind: 'remote-codex', name: 'Offline Mac', status: 'offline' }, tasks: [{ id, title: '离线会话' }] }
  ] });
  const projectRow = key => walk(parent).find(n => n.attrs['data-project-search-id'] === key);
  assert.match(projectRow('win-key').title, /Windows/); assert.match(projectRow('offline-key').title, /离线/);
  projectRow('win-key').listeners.click();
  assert.equal(projectRow('local-key').attrs['aria-expanded'], 'false');
  const remoteTask = walk(parent).find(n => n.title === 'Windows 会话'); remoteTask.listeners.click();
  assert.equal(opened[0].deviceId, 'win'); assert.equal(opened[0].cwd, 'D:\\Tokens'); assert.equal(opened[0].id, id);
  assert.deepEqual(localRoutes, []);
  assert.deepEqual(activation, []);
  projectRow('offline-key').listeners.click();
  const offlineTask = walk(parent).find(n => n.disabled === true && n.attrs['data-project-search-thread-id']);
  assert.ok(offlineTask); offlineTask.listeners.click(); assert.equal(opened.length, 1);
  projectRow('local-key').listeners.click();
  const localTask = walk(parent).find(n => n.title === '本机会话'); localTask.listeners.click();
  assert.equal(nativeProjectExpanded, 0); assert.equal(revealed, 0);
  assert.deepEqual(localRoutes, ['/local/' + id]);
  assert.deepEqual(activation, ['restore', 'tab:' + id, 'route']);
  input.listeners.keydown({ key: 'Escape', stopPropagation() {} });
  assert.equal(input.value, ''); assert.ok(!walk(parent).some(n => n.attrs['data-project-search-id']));
  assert.equal(wrapper.children[0], native); assert.equal(parent.children.length, 2);
});
