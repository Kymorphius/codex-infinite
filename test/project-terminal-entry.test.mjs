import test from 'node:test';
import assert from 'node:assert/strict';
import { isAbsoluteProjectDirectory, localTerminalReference, projectCatalog, projectTerminalDirectories, projectTerminalReference, terminalProjectUrl } from '../public/features/projects/model.js';
import { createProjectController } from '../public/features/projects/index.js';
import { createProjectView } from '../public/features/projects/view.js';
import { createSessionsFeature } from '../public/features/sessions/index.js';

const directories = ['/work/项目 A', '/work/<img src=x onerror=alert(1)>?x="&'];
function owner(id = 'local', status = 'connected') {
  return { device: { id, name: id, kind: id === 'local' ? 'local-codex' : 'remote-codex' }, status,
    snapshot: { schemaVersion: 1, revision: 'a'.repeat(64), capabilities: ['open', 'item-move'], sections: [],
      projects: [{ key: 'p1', id: 'project-one', hostId: 'local', name: '项目 "<&>', source: 'codex', sourceDirectories: directories, conversationKeys: [] }] } };
}
const payload = (...owners) => ({ schemaVersion: 1, devices: owners.length ? owners : [owner()] });

test('terminal references require a connected local owner and preserve exact absolute directory', () => {
  for (const cwd of ['/work/项目 A ', 'D:\\开发\\项目', '\\\\host\\share\\项目']) {
    assert.equal(isAbsoluteProjectDirectory(cwd), true);
    assert.deepEqual(localTerminalReference({ deviceKind: 'local-codex', status: 'connected', cwd, projectName: '项目' }),
      { provider: 'terminal', cwd, projectName: '项目' });
  }
  for (const cwd of ['', 'relative/path', '~/', 'D:relative', '/work/\nsecret', '/work/\0secret', '/'.repeat(4097)]) {
    assert.equal(isAbsoluteProjectDirectory(cwd), false);
  }
  for (const override of [{ deviceKind: 'remote-codex' }, { status: 'offline' }, { stale: true }, { status: 'loading' }]) {
    assert.equal(localTerminalReference({ deviceKind: 'local-codex', status: 'connected', cwd: '/work', ...override }), null);
  }
});

test('project entry selects one exact directory and never substitutes remote or unlisted paths', () => {
  const project = projectCatalog(payload()).projects[0];
  assert.deepEqual(projectTerminalDirectories(project), directories);
  assert.equal(projectTerminalReference(project, undefined), null);
  assert.equal(projectTerminalReference(project, '/unlisted'), null);
  assert.equal(projectTerminalReference(project, directories[1]).cwd, directories[1]);
  for (const replacement of [{ sourceDirectories: [] }, { deviceKind: 'remote-codex' }, { status: 'offline' }, { stale: true }]) {
    assert.deepEqual(projectTerminalDirectories({ ...project, ...replacement }), []);
  }
});

test('project navigation keeps display context, encodes literal paths and opens only the terminal module', () => {
  const reference = projectTerminalReference(projectCatalog(payload()).projects[0], directories[1]);
  const route = terminalProjectUrl(reference, 'http://127.0.0.1:47831/projects.html?theme=dark&embedded=1&task=old&module=sessions');
  const url = new URL(route, 'http://127.0.0.1:47831');
  assert.equal(url.origin, 'http://127.0.0.1:47831');
  assert.equal(url.pathname, '/');
  assert.equal(url.searchParams.get('module'), 'terminal');
  assert.equal(url.searchParams.get('cwd'), directories[1]);
  assert.equal(url.searchParams.get('projectName'), '项目 "<&>');
  assert.equal(url.searchParams.get('theme'), 'dark');
  assert.equal(url.searchParams.get('embedded'), '1');
  assert.equal(url.searchParams.has('task'), false);
  assert.doesNotMatch(route, /<img/);
  assert.throws(() => terminalProjectUrl({ provider: 'terminal', cwd: 'relative' }, url.href));
});

test('project controller creates a project-owned conversation and opens its stable reference', async () => {
  const requests = [], references = [], notices = [];
  const controller = createProjectController({
    fetchImpl: async (...args) => { requests.push(args); return { ok: true, json: async () => args[0].endsWith('/create') ? { conversation: { id: 'managed-id', provider: 'terminal', deviceId: 'local' } } : payload(owner(), owner('remote'), owner('offline', 'offline')) }; },
    onOpenTerminal: reference => references.push(reference), onLocalOpen: () => assert.fail('must not open a native Codex task'),
    notice: (...args) => notices.push(args)
  });
  await controller.refresh();
  assert.equal(references.length, 0);
  const projects = controller.getState().catalog.projects;
  assert.equal(await controller.act(projects[0].identity, 'terminal'), false);
  assert.equal(await controller.act(projects[0].identity, 'terminal', '/unlisted'), false);
  assert.equal(await controller.act(projects[1].identity, 'terminal', directories[0]), false);
  assert.equal(await controller.act(projects[2].identity, 'terminal', directories[0]), false);
  assert.equal(await controller.act(projects[0].identity, 'terminal', directories[1]), true);
  assert.deepEqual(references, [{ id: 'managed-id', provider: 'terminal', deviceId: 'local' }]);
  assert.deepEqual(requests.map(([path]) => path), ['/api/sidebar', '/api/terminal-conversations/create']);
  assert.deepEqual(JSON.parse(requests[1][1].body), { cwd: directories[1], kind: 'claude', projectRef: { source: 'codex', key: 'p1', id: 'project-one', hostId: 'local' } });
  assert.ok(notices.every(([, error]) => error));
  controller.dispose();
});

class Node {
  constructor(tag = 'div') {
    this.tagName = tag; this.children = []; this.dataset = {}; this.listeners = {}; this.attributes = {}; this.value = ''; this.textContent = '';
    this.classList = { toggle() {} };
  }
  set innerHTML(_) { assert.fail('project names and paths must render as text'); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  insertBefore(child, next) { this.children.splice(next ? this.children.indexOf(next) : this.children.length, 0, child); }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(name, listener) { this.listeners[name] = listener; }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  querySelectorAll(selector) {
    const matches = node => selector.startsWith('.') && node.className?.split(' ').includes(selector.slice(1));
    return this.children.flatMap(child => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

test('project cards render one safe directory entry per path and remove entries when the owner disconnects', () => {
  const nodes = new Map();
  const node = selector => { if (!nodes.has(selector)) nodes.set(selector, new Node()); return nodes.get(selector); };
  const card = new Node('article'), fields = new Map();
  card.querySelector = selector => { if (!fields.has(selector)) fields.set(selector, new Node()); return fields.get(selector); };
  node('#project-card-template').content = { firstElementChild: { cloneNode: () => card } };
  const view = createProjectView({ querySelector: node, createElement: tag => new Node(tag) });
  const catalog = projectCatalog(payload());
  const state = { payload: payload(), catalog, visible: catalog.projects, filters: {}, loading: false, stale: false };
  view.render(state);
  const rows = fields.get('.project-paths').children;
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => row.children[0].textContent), directories);
  assert.deepEqual(rows.map(row => row.children[1].dataset.cwd), directories);
  catalog.projects[0].status = 'offline';
  view.render(state);
  assert.ok(fields.get('.project-paths').children.every(row => row.children.length === 1));
});

test('session list treats managed terminals as conversations and exposes archive management', t => {
  const oldDocument = globalThis.document, oldWindow = globalThis.window;
  t.after(() => { globalThis.document = oldDocument; globalThis.window = oldWindow; });
  const nodes = new Map();
  const $ = selector => { if (!nodes.has(selector)) nodes.set(selector, new Node()); return nodes.get(selector); };
  globalThis.document = { querySelector: $, createElement: tag => new Node(tag), activeElement: null, addEventListener() {} };
  globalThis.window = { prompt() {}, confirm() {}, alert() {} };
  const device = { ...owner().device, status: 'connected' };
  const record = { id: 'terminal-one', provider: 'terminal', deviceId: 'local', title: 'Claude 项目会话', kind: 'claude', cwd: directories[0], revision: 1 };
  const task = { ...record, device, project: '项目', terminalConversation: record };
  const state = { taskStatus: 'connected', devices: [device], tasks: [task], terminalConversations: [record, { ...record, id: 'archived', archived: true }] }, opened = [];
  const feature = createSessionsFeature({ state, $, formatDate: () => '', statusLabel: () => '', requestOpen: item => opened.push(item),
    fetchImpl: () => assert.fail('merely rendering/opening must not start a runtime') });
  feature.render();
  const list = $('[data-testid="session-project-list"]');
  assert.equal(list.querySelectorAll('.session-project-terminal').length, 0);
  assert.equal(list.querySelectorAll('.terminal-session-actions').length, 1);
  const open = list.querySelectorAll('.session-open')[0];
  assert.equal(open.textContent, '打开会话'); open.listeners.click();
  assert.deepEqual(opened, [task]);
  const archives = $('[data-module-panel="sessions"]').querySelectorAll('.terminal-archives')[0];
  assert.equal(archives.hidden, false);
  assert.equal(archives.children[0].textContent, '已归档的终端会话 1');
});
