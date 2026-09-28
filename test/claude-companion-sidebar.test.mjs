import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createClaudeCompanionSource } from '../src/claude-companion-source.mjs';
import { TerminalService } from '../src/terminal-service.mjs';
import { TerminalConversationService } from '../src/terminal-conversation-service.mjs';
import { terminalConversationRecord, terminalConversationCreate } from '../src/terminal-conversation-contract.mjs';
import { nativeCompanionPlacement, createNativeTerminalSidebar } from '../src/native-terminal-sidebar.mjs';

const THREAD = '01a0be7e-3c97-76a3-b5da-36c782facc71', SESSION = '3f610a4b-8878-4713-a824-788bbfce53fb';

async function routerState(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'companion-source-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const add = async (thread, summary, extra = {}) => {
    const directory = path.join(root, 'claude-companions', thread);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'session.json'), JSON.stringify({ version: 1, threadId: thread, state: 'complete', updatedAt: 'x', ...summary }));
    for (const [name, content] of Object.entries(extra)) await fs.writeFile(path.join(directory, name), content);
    return directory;
  };
  return { root, add };
}

test('the companion source reads only valid public summaries under the router state directory', async t => {
  const { root, add } = await routerState(t);
  assert.deepEqual(await createClaudeCompanionSource({ routerStateDirectory: root }).list(), [], 'no companions yet');
  const directory = await add(THREAD, { sessionId: SESSION.toUpperCase() }, { 'binding.json': 'x'.repeat(10000) });
  await add('22222222-2222-4222-8222-222222222222', { version: 2, sessionId: SESSION });
  await add('33333333-3333-4333-8333-333333333333', { threadId: '44444444-4444-4444-8444-444444444444', sessionId: SESSION });
  await add('55555555-5555-4555-8555-555555555555', { sessionId: 'not-a-uuid' });
  await fs.mkdir(path.join(root, 'claude-companions', 'not-a-thread'));
  await fs.symlink(directory, path.join(root, 'claude-companions', '66666666-6666-4666-8666-666666666666'));
  const source = createClaudeCompanionSource({ routerStateDirectory: root });
  assert.deepEqual(await source.list(), [{ threadId: THREAD, sessionId: SESSION, cwd: directory }]);
  assert.deepEqual(await createClaudeCompanionSource({}).list(), []);
});

test('companionOf is adoption-only and restricted to Claude records', () => {
  const base = { id: SESSION, provider: 'terminal', deviceId: 'd', cwd: '/c', kind: 'claude', title: 'Claude CLI', projectRef: null,
    pinned: false, archived: false, createdAt: '2026-09-28T00:00:00Z', updatedAt: '2026-09-28T00:00:00Z', revision: 1 };
  assert.equal(terminalConversationRecord({ ...base, companionOf: THREAD.toUpperCase() }, 'd').companionOf, THREAD);
  assert.equal('companionOf' in terminalConversationRecord(base, 'd'), false);
  assert.throws(() => terminalConversationRecord({ ...base, kind: 'shell', companionOf: THREAD }, 'd'), /伴生/);
  assert.throws(() => terminalConversationCreate({ cwd: '/c', kind: 'claude', companionOf: THREAD }), /./);
});

async function service(t, { holders = [] } = {}) {
  const { root, add } = await routerState(t), home = path.join(root, 'home');
  await fs.mkdir(home);
  const cwd = await add(THREAD, { sessionId: SESSION });
  const terminalService = new TerminalService({ userHome: home, defaultCwd: home, spawnProcess: async () => ({ onData: () => ({ dispose() {} }),
    onExit: () => ({ dispose() {} }), kill: async () => {}, write() {}, resize() {} }) });
  t.after(() => terminalService.dispose());
  const occupancy = async () => holders[0] || null; occupancy.all = async () => holders;
  const conversations = new TerminalConversationService({ terminalService, deviceId: 'test-device', filePath: path.join(root, 'registry.json'),
    companions: createClaudeCompanionSource({ routerStateDirectory: root }), claudeOccupancy: occupancy,
    claudeTranscripts: { summary: async () => ({ title: 'Router 调试', lastUserMessageAt: null, ids: [SESSION] }), search: async () => null } });
  return { conversations, cwd, holders };
}

test('listing adopts each companion once as a Claude record keyed by its Claude session', async t => {
  const { conversations, cwd } = await service(t);
  const [record] = (await conversations.list()).conversations;
  assert.equal(record.id, SESSION); assert.equal(record.companionOf, THREAD); assert.equal(record.kind, 'claude');
  assert.equal(record.cwd, cwd); assert.equal(record.title, 'Router 调试'); assert.equal(record.occupiedBy, null);
  await conversations.update({ id: SESSION, expectedRevision: 1, archived: true });
  const again = (await conversations.list()).conversations;
  assert.equal(again.length, 1); assert.equal(again[0].archived, true, 'adoption never rewrites an existing record');
});

test('a Codex turn in progress makes the companion read-only and cannot be taken over', async t => {
  const { conversations, holders } = await service(t);
  await conversations.list();
  holders.push({ pid: 4242, sessionId: SESSION, status: 'busy', codexTurn: true });
  const record = await conversations.open({ id: SESSION });
  assert.equal(record.occupiedBy, 'codex'); assert.equal(record.occupiedElsewhere, true);
  await assert.rejects(conversations.start({ id: SESSION, takeover: true }), error => error.statusCode === 409 && /Codex/.test(error.message));
});

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

test('the companion row mounts right under its Codex thread list item and disappears with it', () => {
  // Native shape: list > item(role) > wrapper > wrapper > thread row, each wrapper with one child.
  const list = node(), item = node({ role: 'listitem' }), wrapper = node(), row = node({ 'data-app-action-sidebar-thread-id': 'local:' + THREAD });
  const nextThread = node({ role: 'listitem' });
  wrapper.append(row); item.append(wrapper); list.append(item, nextThread);
  let rows = [row];
  const documentRef = { head: node(), createElement: () => node(),
    querySelector: selector => rows.find(value => selector === '[data-app-action-sidebar-thread-id="' + value.attributes['data-app-action-sidebar-thread-id'] + '"]') || null };
  const record = { id: SESSION, provider: 'terminal', deviceId: 'd', kind: 'claude', title: 'Router 调试', cwd: '/c', revision: 1,
    companionOf: THREAD, projectRef: null, pinned: false, archived: false, occupiedBy: 'codex' };
  assert.deepEqual(nativeCompanionPlacement(documentRef, record), { parent: list, after: item });
  const opened = [];
  const sidebar = createNativeTerminalSidebar({ documentRef, readModel: () => ({ sections: [{ kind: 'tasks', node: { parentElement: node() } }] }), open: value => opened.push(value), menu() {} });
  sidebar.render([record]);
  assert.equal(list.children[1].dataset.cccTerminalSidebar, SESSION, 'directly after its thread, before the next thread');
  assert.equal(list.children[2], nextThread);
  const companionRow = list.children[1].children[0], button = companionRow.children[0];
  assert.equal(companionRow.dataset.companion, 'true');
  assert.equal(button.children[0].textContent, '↳'); assert.equal(button.children[2].textContent, 'Codex 回复中');
  button.onclick(); assert.equal(opened[0], record);
  rows = []; sidebar.render([{ ...record, occupiedBy: null }]);
  assert.equal(list.children.length, 2, 'hidden while the Codex thread row is not rendered');
  sidebar.destroy();
});
