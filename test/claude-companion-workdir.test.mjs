import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createClaudeCompanionSource } from '../src/claude-companion-source.mjs';
import { TerminalService } from '../src/terminal-service.mjs';
import { TerminalConversationService } from '../src/terminal-conversation-service.mjs';

const THREAD = '01a0be7e-3c97-76a3-b5da-36c782facc71', SESSION = '54869a2e-3f76-41f0-8417-e1016043e964';

async function world(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'companion-cwd-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'claude-companions', THREAD), project = path.join(root, 'project');
  await fs.mkdir(directory, { recursive: true }); await fs.mkdir(project);
  const publish = cwd => fs.writeFile(path.join(directory, 'session.json'), JSON.stringify({ version: 1, threadId: THREAD, sessionId: SESSION, state: 'complete', ...(cwd === undefined ? {} : { cwd }), updatedAt: String(Math.random()) }));
  return { root, directory, project, publish };
}

test('the companion source uses the working directory Router publishes, else the companion directory', async t => {
  const { root, directory, project, publish } = await world(t);
  const source = createClaudeCompanionSource({ routerStateDirectory: root });
  await publish(project);
  assert.equal((await source.list())[0].cwd, await fs.realpath(project));
  for (const bad of [undefined, 'relative/dir', path.join(root, 'missing'), 42]) {
    await publish(bad); assert.equal((await source.list())[0].cwd, directory, `fallback for ${bad}`);
  }
});

test('an adopted companion follows Router into the project; other records never move', async t => {
  const { root, directory, project, publish } = await world(t);
  const terminalService = new TerminalService({ userHome: root, defaultCwd: root, spawnProcess: async () => ({ onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), kill: async () => {}, write() {}, resize() {} }) });
  t.after(() => terminalService.dispose());
  const conversations = new TerminalConversationService({ terminalService, deviceId: 'mac', filePath: path.join(root, 'registry.json'),
    companions: createClaudeCompanionSource({ routerStateDirectory: root }), claudeOccupancy: async () => null,
    claudeTranscripts: { summary: async id => ({ title: '', customTitle: '', lastUserMessageAt: null, ids: [id] }), search: async () => null } });
  await publish(undefined);
  let [companion] = (await conversations.list()).conversations;
  assert.equal(companion.cwd, directory, 'older summaries without cwd keep the companion directory');
  await publish(project);
  [companion] = (await conversations.list()).conversations;
  assert.equal(companion.cwd, await fs.realpath(project)); assert.equal(companion.companionOf, THREAD);
  assert.equal(companion.revision, 2, 'relocated once'); await conversations.list();
  assert.equal((await conversations.open({ id: SESSION })).revision, 2, 'no churn while unchanged');
  const store = conversations.store;
  const plain = await store.create({ cwd: root, kind: 'claude', title: 'Claude CLI', projectRef: null });
  assert.equal((await store.relocateCompanion(plain.id, project)).cwd, root, 'only companions move');
});
