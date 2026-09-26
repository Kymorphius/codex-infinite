import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeTerminalProjectList, createNativeTerminalSidebar } from '../src/native-terminal-sidebar.mjs';
import { createNativeTerminalActions } from '../src/native-terminal-actions.mjs';

function node(tag = 'div') {
  return { tag, attributes: {}, dataset: {}, style: {}, children: [], parentElement: null,
    getAttribute(key) { return this.attributes[key] ?? null; }, setAttribute(key, value) { this.attributes[key] = value; },
    append(...values) { for (const value of values) { value.remove?.(); value.parentElement = this; this.children.push(value); } },
    insertBefore(value, before) { value.remove?.(); value.parentElement = this; const index = this.children.indexOf(before); if (index < 0) this.children.push(value); else this.children.splice(index, 0, value); },
    get nextSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1] || null; },
    get previousElementSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) - 1] || null; },
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(value => value !== this); this.parentElement = null; },
    addEventListener() {} };
}
function harness() {
  const lists = [], head = node(), sidebar = node(), projects = node(), chats = node(), pinned = node();
  sidebar.append(projects, chats, pinned); const projectList = node(); projectList.setAttribute('data-app-action-sidebar-project-list-id', 'local-project-a'); projects.append(projectList); lists.push(projectList);
  const nativeChild = node('native'); projectList.append(nativeChild);
  const sections = [{ kind: 'projects', node: { parentElement: projects } }, { kind: 'tasks', node: { parentElement: chats } }, { kind: 'pinned', node: { parentElement: pinned } }];
  const projectRows = [];
  const documentRef = { head, body: sidebar, createElement: node, querySelectorAll: selector => selector === '[data-app-action-sidebar-project-list-id]' ? lists : projectRows };
  return { lists, documentRef, sections, projectList, nativeChild, pinned, chats, projectRows, projects };
}
const record = { id: 'conversation-a', provider: 'terminal', deviceId: 'mac', title: '项目 Claude', cwd: '/work', kind: 'claude', revision: 1,
  projectRef: { source: 'codex', hostId: 'local', id: 'project-a', key: 'codex:project:local:project-a' } };

test('owned rows mount inside exact native project children and preserve native nodes on refresh', () => {
  const h = harness(), opened = [], menus = [];
  const renderer = createNativeTerminalSidebar({ documentRef: h.documentRef, readModel: () => ({ sections: h.sections }), open: value => opened.push(value), menu: value => menus.push(value) });
  renderer.render([record], record.id);
  assert.equal(h.projectList.children[0], h.nativeChild); assert.equal(h.projectList.children.length, 2);
  const root = h.projectList.children[1], row = root.children[0]; assert.equal(row.dataset.selected, 'true');
  assert.equal(root.attributes['data-app-action-sidebar-thread-id'], undefined);
  row.children[0].onclick(); row.children[1].onclick(); assert.equal(opened[0], record); assert.equal(menus[0], record);
  renderer.render([record], record.id); assert.equal(h.projectList.children[1], root, 'unchanged snapshots do not churn DOM');
  renderer.render([{ ...record, title: '重命名' }], record.id); assert.equal(h.projectList.children[0], h.nativeChild);
  assert.equal(h.projectList.children[1].children[0].children[0].children[1].textContent, '重命名');
  renderer.render([{ ...record, archived: true }]); assert.deepEqual(h.projectList.children, [h.nativeChild]); renderer.destroy();
});

test('pinning and unassigned records project into native management sections without changing ownership', () => {
  const h = harness(); const renderer = createNativeTerminalSidebar({ documentRef: h.documentRef, readModel: () => ({ sections: h.sections }), open() {}, menu() {} });
  renderer.render([{ ...record, pinned: true }, { ...record, id: 'unassigned', projectRef: null }]);
  assert.equal(h.pinned.children.length, 1); assert.equal(h.chats.children.length, 1); assert.equal(h.projectList.children.length, 1);
  renderer.render([{ ...record, pinned: false }]); assert.equal(h.pinned.children.length, 0); assert.equal(h.projectList.children.length, 2);
  h.projectList.children[1].remove(); renderer.render([record]); assert.equal(h.projectList.children.length, 2, 'native remount recovers provider rows'); renderer.destroy();
});

test('project matching rejects remote native hosts and cloud references', () => {
  const h = harness(); assert.equal(nativeTerminalProjectList(h.documentRef, record), h.projectList);
  assert.equal(nativeTerminalProjectList(h.documentRef, { ...record, projectRef: { ...record.projectRef, id: 'different' } }), null);
  assert.equal(nativeTerminalProjectList(h.documentRef, { ...record, projectRef: { ...record.projectRef, hostId: 'remote' } }), null);
  assert.equal(nativeTerminalProjectList(h.documentRef, { ...record, projectRef: { ...record.projectRef, source: 'chatgpt' } }), null);
});

test('empty native projects mount provider-owned siblings and honor collapse without inventing native children', () => {
  const h = harness(); h.lists.length = 0; h.projectList.remove();
  const projectRow = node(), followingProject = node(); projectRow.setAttribute('data-app-action-sidebar-project-id', 'project-a');
  h.projectRows.push(projectRow); h.projects.append(projectRow, followingProject);
  const renderer = createNativeTerminalSidebar({ documentRef: h.documentRef, readModel: () => ({ sections: h.sections }), open() {}, menu() {} });
  renderer.render([record, { ...record, id: 'second' }]);
  assert.equal(h.projects.children[0], projectRow); assert.equal(h.projects.children[1].dataset.cccTerminalSidebar, record.id);
  assert.equal(h.projects.children[2].dataset.cccTerminalSidebar, 'second'); assert.equal(h.projects.children[3], followingProject);
  projectRow.setAttribute('data-app-action-sidebar-project-collapsed', 'true'); renderer.render([record]);
  assert.deepEqual(h.projects.children, [projectRow, followingProject]);
  projectRow.setAttribute('data-app-action-sidebar-project-collapsed', 'false'); renderer.render([record]);
  assert.equal(h.projects.children[1].dataset.cccTerminalSidebar, record.id); renderer.destroy();
  assert.deepEqual(h.projects.children, [projectRow, followingProject]);
});

test('native project creation uses its authoritative model key and never guesses a directory', async () => {
  const h = harness(), calls = [], opened = [];
  const project = { id: 'project-a', sourceDirectories: ['/work'] };
  const model = { projectByKey: new Map([['native-key', { group: { projectId: 'project-a', hostId: 'local' } }]]) };
  const actions = createNativeTerminalActions({ documentRef: h.documentRef, windowRef: { __codexControlConsoleOpenTerminalConversation: value => opened.push(value) },
    request: async (operation, input) => { calls.push({ operation, input }); return { conversation: record }; }, accept() {}, readModel: () => model });
  assert.equal(await actions.create(project, '/work', 'claude'), true);
  assert.deepEqual(calls[0], { operation: 'create', input: { cwd: '/work', kind: 'claude', projectRef: { source: 'codex', key: 'native-key', id: 'project-a', hostId: 'local' } } });
  assert.equal(opened[0], record);
});

test('empty-project fallback follows same-parent native reordering and remains stable afterwards', () => {
  const h = harness(); h.lists.length = 0; h.projectList.remove();
  const projectRow = node(), otherProject = node(); projectRow.setAttribute('data-app-action-sidebar-project-id', 'project-a');
  h.projectRows.push(projectRow); h.projects.append(projectRow, otherProject);
  const renderer = createNativeTerminalSidebar({ documentRef: h.documentRef, readModel: () => ({ sections: h.sections }), open() {}, menu() {} });
  const records = [record, { ...record, id: 'second' }]; renderer.render(records);
  h.projects.append(projectRow); // React moves only its own project row, leaving our rows behind.
  renderer.render(records);
  assert.equal(h.projects.children[0], otherProject); assert.equal(h.projects.children[1], projectRow);
  const first = h.projects.children[2], second = h.projects.children[3];
  assert.equal(first.dataset.cccTerminalSidebar, record.id); assert.equal(second.dataset.cccTerminalSidebar, 'second');
  renderer.render(records);
  assert.equal(h.projects.children[2], first); assert.equal(h.projects.children[3], second, 'repaired placement does not trigger a render loop');
  h.projects.insertBefore(otherProject, second); // A native sibling inserted into the owned group must also be repaired.
  renderer.render(records);
  assert.equal(h.projects.children[0], projectRow); assert.equal(h.projects.children[1].dataset.cccTerminalSidebar, record.id);
  assert.equal(h.projects.children[2].dataset.cccTerminalSidebar, 'second'); assert.equal(h.projects.children[3], otherProject);
  renderer.destroy();
});
