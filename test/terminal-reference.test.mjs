import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTerminalReference, resolveTerminalSelection, terminalReferenceSessions } from '../public/features/terminal/presentation.js';
import { createNavigation } from '../public/core/navigation.js';

const sessions = [
  { id: 'claude-a', cwd: '/one/project', status: 'running' },
  { id: 'shell-a', cwd: '/one/project', status: 'running' },
  { id: 'claude-b', cwd: '/two/project', status: 'running' },
  { id: 'nested', cwd: '/one/project/subdir', status: 'running' }
];

test('terminal references validate provider, owner, identity and literal absolute path', () => {
  const reference = normalizeTerminalReference({ provider: 'terminal', deviceId: 'this-mac', cwd: '/项目 & A', projectName: '<项目>\n', sessionId: 'claude-a' }, 'this-mac');
  assert.deepEqual(reference, { provider: 'terminal', cwd: '/项目 & A', projectName: '<项目>', sessionId: 'claude-a' });
  for (const value of [null, {}, { provider: 'codex' }, { provider: 'terminal', deviceId: 'other' },
    { provider: 'terminal', cwd: 'relative' }, { provider: 'terminal', cwd: '/tmp\ncommand' },
    { provider: 'terminal', sessionId: '../wrong' }, { provider: 'terminal', projectName: [] }]) {
    assert.throws(() => normalizeTerminalReference(value, 'this-mac'));
  }
  assert.equal(normalizeTerminalReference({ provider: 'terminal', cwd: 'C:\\project' }).cwd, 'C:\\project');
});

test('project context matches exact cwd and never merges equal basenames or nested projects', () => {
  const reference = { cwd: '/one/project' };
  assert.deepEqual(terminalReferenceSessions(sessions, reference).map(item => item.id), ['claude-a', 'shell-a']);
  assert.deepEqual(resolveTerminalSelection(sessions, reference, 'claude-b'), { id: 'claude-a', error: '' });
  assert.deepEqual(resolveTerminalSelection(sessions, reference, 'shell-a'), { id: 'shell-a', error: '' });
  assert.deepEqual(resolveTerminalSelection(sessions, { cwd: '/empty' }, 'claude-a'), { id: '', error: '' });
});

test('explicit session links select exactly that runtime or report missing without fallback', () => {
  assert.deepEqual(resolveTerminalSelection(sessions, { sessionId: 'shell-a' }, 'claude-a'), { id: 'shell-a', error: '' });
  for (const reference of [{ sessionId: 'closed' }, { cwd: '/one/project', sessionId: 'claude-b' }]) {
    const result = resolveTerminalSelection(sessions, reference, 'claude-a');
    assert.equal(result.id, '');
    assert.match(result.error, /已关闭|不属于/u);
  }
});

test('embedded terminal opens require the exact parent origin and never use Codex openTask', () => {
  const callbacks = {}, opened = [], activated = [], parent = {};
  const element = { textContent: '' };
  const windowRef = { parent, addEventListener(type, callback) { callbacks[type] = callback; } };
  const documentRef = { title: '', querySelectorAll() { return []; }, addEventListener() {} };
  const state = { module: 'board' };
  createNavigation({ state, modules: { terminal: { title: '终端会话', caption: '' }, board: { title: '看板', caption: '' } },
    $: () => element, showToast() {}, onActivate: module => activated.push(module), onRefresh() {},
    onOpenTerminalConversation: reference => opened.push(reference), documentRef, windowRef }).bind();
  const data = { type: 'codex-control-console-open-terminal-conversation', reference: { provider: 'terminal', sessionId: 'shell-a' } };
  callbacks.message({ source: {}, origin: 'app://-', data });
  callbacks.message({ source: parent, origin: 'https://foreign.invalid', data });
  assert.deepEqual(opened, []);
  assert.equal(state.module, 'board');
  callbacks.message({ source: parent, origin: 'app://-', data });
  assert.deepEqual(opened, [data.reference]);
  assert.deepEqual(activated, ['terminal']);
  assert.equal(state.module, 'terminal');
});
