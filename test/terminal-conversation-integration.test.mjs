import { initialAppModule } from '../public/core/state.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { projectTerminalConversations } from '../src/terminal-conversation-projection.mjs';
import { createTerminalProjectValidator } from '../src/terminal-project-adapter.mjs';
import { conversationCatalog, openAction } from '../public/features/conversations/model.js';
import { isNativeLocalTask } from '../public/core/tasks.js';
import { planModelReplacement } from '../public/features/sessions/model-bulk.js';
import { openManagedTerminal } from '../public/core/terminal-conversations.js';

const device = { id: 'node-one', kind: 'local-codex', name: '本机', status: 'connected' };
const project = { source: 'codex', key: 'codex:project:p', id: 'p', hostId: 'local', name: '项目', sourceDirectories: ['/work/app'], conversationKeys: [] };
const record = { id: '11111111-1111-4111-8111-111111111111', provider: 'terminal', deviceId: device.id,
  kind: 'claude', title: 'CLI 会话', cwd: '/work/app', projectRef: project, revision: 1, status: 'running', updatedAt: '2026-09-26T01:00:00Z' };

test('managed metadata joins display catalogs on the physical device without native execution eligibility', () => {
  const native = { id: record.id, title: 'native collision', device, model: 'gpt', status: 'active' };
  const projected = projectTerminalConversations({ tasks: [native], devices: [device], status: 'connected' },
    { deviceId: device.id, conversations: [record, { ...record, id: 'archived', archived: true }] }, device, [project]);
  assert.equal(projected.tasks.length, 2); assert.equal(projected.devices.length, 1);
  assert.equal(projected.terminalConversations.length, 2);
  const task = projected.tasks[1];
  assert.equal(task.project, '项目');
  assert.equal(task.provider, 'terminal'); assert.equal(task.status, 'unknown');
  assert.equal(isNativeLocalTask(task), false); assert.equal(isNativeLocalTask(native), true);
  assert.equal(planModelReplacement([{ ...task, model: 'gpt' }], new Map([[device.id, [{ id: 'new' }]]]), 'gpt', 'new').eligible.length, 0);
});

test('project reference acceptance requires owner identity and exact authoritative cwd', async () => {
  const validate = createTerminalProjectValidator({ read: async () => ({ projects: [project] }) });
  assert.equal(await validate(project, '/work/app'), true);
  for (const [ref, cwd] of [[project, '/work/app/sub'], [{ ...project, hostId: 'remote' }, '/work/app'],
    [{ ...project, key: 'different' }, '/work/app'], [{ ...project, source: 'chatgpt' }, '/work/app']]) {
    assert.equal(await validate(ref, cwd), false);
  }
});

test('conversation catalog preserves provider identity and does not infer model activity from a running PTY', () => {
  const sidebar = { devices: [{ device, status: 'connected', snapshot: { conversations: [], projects: [project], sections: [] } }] };
  const items = conversationCatalog(sidebar, { terminalConversations: [record] });
  assert.equal(items[0].project.name, '项目'); assert.equal(items[0].state.id, 'review');
  assert.deepEqual(openAction(items[0]), { provider: 'terminal', conversationId: record.id });
  assert.deepEqual(conversationCatalog(sidebar, { terminalConversations: [{ ...record, archived: true }] }), []);
});

test('managed opens target the native conversation host or stable standalone view without spawning', () => {
  const messages = [], parent = { postMessage: (...args) => messages.push(args) };
  openManagedTerminal(record, { parent });
  assert.deepEqual(messages, [[{ type: 'codex-control-console-open-terminal-conversation', reference: {
    provider: 'terminal', conversationId: record.id, deviceId: device.id,
  } }, 'app://-']]);
  let opened; const standalone = { location: { href: 'http://127.0.0.1:47831/projects.html', assign: url => { opened = new URL(url); } } };
  standalone.parent = standalone; openManagedTerminal(record, standalone);
  assert.equal(opened.searchParams.get('conversationId'), record.id);
  assert.equal(opened.searchParams.get('view'), 'conversation');
});

test('bare terminal module links enter unified sessions; only concrete conversation views use the internal host', () => {
  assert.equal(initialAppModule('?module=terminal'), 'sessions');
  assert.equal(initialAppModule('?module=terminal&cwd=/work/app'), 'sessions');
  assert.equal(initialAppModule('?module=terminal&view=conversation&conversationId=id'), 'terminal');
});
