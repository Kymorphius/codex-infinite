import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { terminalProjectConversations } from '../src/project-search.mjs';
import { buildNativeProjectSearchInjectionScript } from '../src/native-project-search.mjs';

const ref = { source: 'codex', key: 'codex:project:sidebar-id', id: 'sidebar-id', hostId: 'local' };
const terminal = (id, extra = {}) => ({ id, provider: 'terminal', deviceId: 'mac', title: 'Claude CLI', cwd: '/work/app', kind: 'claude', status: 'running', archived: false, projectRef: ref, updatedAt: '2026-09-27T10:00:00Z', ...extra });

test('terminal conversations join local projects by verified cwd, never remote or archived ones', () => {
  const records = [terminal('a'), terminal('b', { updatedAt: '2026-09-27T12:00:00Z', kind: 'shell' }), terminal('archived', { archived: true }),
    terminal('other', { cwd: '/work/other' }), terminal('loose', { projectRef: null }), { ...terminal('codex'), provider: 'codex' }];
  const local = { id: 'server-id', sourceDirectories: ['/work/app'], device: { kind: 'local-codex' } };
  assert.deepEqual(terminalProjectConversations(local, records).map(record => record.id), ['b', 'a']);
  assert.deepEqual(terminalProjectConversations({ ...local, device: { kind: 'remote-codex' } }, records), []);
  assert.deepEqual(terminalProjectConversations({ id: 'x' }, records), []);
  assert.deepEqual(terminalProjectConversations(local, null), []);
});

test('project search lists terminal rows with a provider tag under the expanded local project and opens them', () => {
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.style = {}; this.listeners = {}; }
    append(...nodes) { for (const node of nodes) { this.children.push(node); node.parentElement = this; } }
    insertBefore(node) { this.children.unshift(node); node.parentElement = this; }
    remove() {} setAttribute(k, v) { this.attrs[k] = v; } getAttribute(k) { return this.attrs[k] ?? null; }
    get attributes() { return []; } addEventListener(k, fn) { this.listeners[k] = fn; } replaceChildren() { this.children = []; }
  }
  const parent = new Node(), wrapper = new Node(), native = new Node(); parent.append(wrapper); wrapper.append(native);
  const walk = node => [node, ...node.children.flatMap(walk)];
  const opened = [];
  let records = [terminal('a')];
  const window = { __cccTerminalConversations: { records: () => records }, __codexControlConsoleOpenTerminalConversation: record => opened.push(record.id) };
  const context = vm.createContext({ window, document: { documentElement: parent, querySelector: selector => selector.startsWith('section') ? native : null,
    querySelectorAll: () => [], createElement: tag => new Node(tag), createElementNS: (_, tag) => new Node(tag) },
    MutationObserver: class { observe() {} disconnect() {} }, requestAnimationFrame: fn => fn() });
  vm.runInContext(buildNativeProjectSearchInjectionScript(), context);
  window.__codexControlConsoleProjectSearch.set({ stale: false, projects: [{ id: 'server-id', searchKey: 'local', name: '看板', sourceDirectories: ['/work/app'],
    device: { kind: 'local-codex', name: '本机', status: 'connected' }, tasks: [] }] });
  const input = walk(parent).find(node => node.tag === 'input'); input.value = '看板'; input.listeners.input();
  walk(parent).find(node => node.attrs['data-project-search-id'] === 'local').listeners.click();
  const row = () => walk(parent).find(node => node.attrs['data-project-search-terminal-id'] === 'a');
  assert.ok(row()); assert.ok(!walk(parent).some(node => node.textContent === '暂无未归档会话'));
  const tag = walk(row()).find(node => node.attrs['data-terminal-engine']);
  assert.equal(tag.textContent, 'CLI'); assert.equal(tag.attrs['data-running'], 'true');
  row().listeners.click(); assert.deepEqual(opened, ['a']);
  records = [terminal('a', { archived: true })]; window.__codexControlConsoleProjectSearch.refresh();
  assert.equal(row(), undefined); assert.ok(walk(parent).some(node => node.textContent === '暂无未归档会话'));
});
