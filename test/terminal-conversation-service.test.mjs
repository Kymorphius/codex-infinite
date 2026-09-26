import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TerminalService } from '../src/terminal-service.mjs';
import { TerminalConversationService } from '../src/terminal-conversation-service.mjs';
import { terminalLaunch } from '../src/terminal-process.mjs';

async function fixture(t, overrides = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'managed-terminal-'));
  const processes = [];
  const terminalService = new TerminalService({ userHome: directory, defaultCwd: directory,
    spawnProcess: async input => {
      const listeners = {};
      const process = { input, killed: 0, onData: listener => { listeners.data = listener; return { dispose() {} }; },
        onExit: listener => { listeners.exit = listener; return { dispose() {} }; },
        kill: async () => { process.killed++; }, write() {}, resize() {}, exit: () => listeners.exit({ exitCode: 0 }) };
      processes.push(process); return process;
    } });
  const options = { terminalService, filePath: path.join(directory, 'registry.json'), deviceId: 'test-device', ...overrides };
  const service = new TerminalConversationService(options);
  t.after(async () => { await terminalService.dispose(); await fs.rm(directory, { recursive: true, force: true }); });
  return { service, terminalService, directory, processes, options };
}

test('managed identity persists across restarts without automatically starting a PTY', async t => {
  const { service, terminalService, directory, processes, options } = await fixture(t);
  const created = await service.create({ cwd: directory, kind: 'shell', title: '项目 Shell' });
  assert.equal(created.status, 'running'); assert.equal(created.provider, 'terminal');
  assert.notEqual(created.id, created.runtimeSessionId); assert.equal(created.revision, 1);
  const renamed = await service.update({ id: created.id, expectedRevision: 1, title: '发布排查', pinned: true });
  assert.equal(renamed.revision, 2);
  await terminalService.dispose();
  const freshTerminal = new TerminalService({ defaultCwd: directory });
  const fresh = new TerminalConversationService({ ...options, terminalService: freshTerminal });
  const restored = await fresh.open({ id: created.id });
  assert.equal(restored.title, '发布排查'); assert.equal(restored.pinned, true);
  assert.equal(restored.runtimeSessionId, null); assert.equal(restored.status, 'stopped');
  assert.equal(processes.length, 1); assert.equal(processes[0].killed, 1);
  assert.equal((await fresh.list()).conversations.length, 1);
  assert.equal((await fs.stat(options.filePath)).mode & 0o777, 0o600);
});

test('concurrent start is idempotent; stop and archive retain conversation independently', async t => {
  const { service, directory, processes } = await fixture(t);
  const created = await service.create({ cwd: directory });
  await service.stop({ id: created.id });
  const [a, b] = await Promise.all([service.start({ id: created.id }), service.start({ id: created.id })]);
  assert.equal(a.runtimeSessionId, b.runtimeSessionId); assert.equal(processes.length, 2);
  const archived = await service.update({ id: created.id, expectedRevision: 1, archived: true });
  assert.equal(archived.status, 'running'); assert.equal(processes[1].killed, 0);
  await assert.rejects(service.start({ id: created.id }), { statusCode: 409 });
  assert.equal(processes[1].killed, 0); assert.equal(processes.length, 2);
  const stopped = await service.stop({ id: created.id });
  assert.equal(stopped.archived, true); assert.equal(stopped.status, 'stopped'); assert.equal(processes[1].killed, 1);
  const restored = await service.update({ id: created.id, expectedRevision: 2, archived: false });
  assert.equal(restored.status, 'stopped'); assert.equal((await service.list()).conversations.length, 1);
});

test('stop queued after a pending spawn terminates that owned runtime', async t => {
  const { service, terminalService, directory } = await fixture(t);
  const created = await service.create({ cwd: directory }); await service.stop({ id: created.id });
  const original = terminalService.spawnProcess; let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), pending = new Promise(resolve => { entered = resolve; });
  terminalService.spawnProcess = async options => { entered(); await gate; return original(options); };
  const start = service.start({ id: created.id }); await pending;
  const stop = service.stop({ id: created.id }); release(); await start;
  assert.equal((await stop).status, 'stopped'); assert.equal(terminalService.list().sessions.length, 0);
});

test('metadata revision rejects stale writes and serializes concurrent updates', async t => {
  const { service, directory } = await fixture(t);
  const created = await service.create({ cwd: directory });
  const outcomes = await Promise.allSettled([
    service.update({ id: created.id, expectedRevision: 1, title: 'first' }),
    service.update({ id: created.id, expectedRevision: 1, title: 'second' }),
  ]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find(result => result.status === 'rejected').reason.statusCode, 409);
  assert.equal((await service.open({ id: created.id })).revision, 2);
});

test('explicit native project and cwd are validated on create and reassignment', async t => {
  const references = [];
  const { service, directory } = await fixture(t, { validateProject: async (reference, cwd) => {
    references.push({ reference, cwd }); return reference.id === 'known' && reference.hostId === 'local';
  } });
  const projectRef = { source: 'codex', key: 'codex:known', id: 'known', hostId: 'local' };
  const created = await service.create({ cwd: directory, projectRef });
  assert.deepEqual(created.projectRef, projectRef); assert.equal(references[0].cwd, directory);
  await assert.rejects(service.create({ cwd: directory, projectRef: { ...projectRef, hostId: 'remote' } }), { statusCode: 400 });
  await assert.rejects(service.update({ id: created.id, expectedRevision: 1, projectRef: { ...projectRef, id: 'missing' } }), { statusCode: 400 });
  assert.equal((await service.list()).conversations.length, 1);
  assert.equal((await service.update({ id: created.id, expectedRevision: 1, projectRef: null })).projectRef, null);
  await assert.rejects(service.create({ kind: 'shell' }), { statusCode: 400 });
  await assert.rejects(service.create({ cwd: 'relative' }), { statusCode: 400 });
});

test('failed launch retains recoverable metadata and an explicit retry uses the same identity', async t => {
  const { service, terminalService, directory } = await fixture(t);
  const original = terminalService.spawnProcess;
  terminalService.spawnProcess = async () => { throw Error('PTY unavailable'); };
  const created = await service.create({ cwd: directory });
  assert.equal(created.status, 'stopped'); assert.equal(created.runtimeError, 'PTY unavailable');
  assert.equal((await service.list()).conversations.length, 1);
  await assert.rejects(service.start({ id: created.id }), /PTY unavailable/u);
  terminalService.spawnProcess = original;
  const retried = await service.start({ id: created.id });
  assert.equal(retried.id, created.id); assert.equal(retried.runtimeError, null); assert.equal(retried.status, 'running');
});

test('managed Claude starts a stable UUID and resumes only a verified transcript', async t => {
  let exists = false;
  const { service, directory, processes } = await fixture(t, { transcriptExists: async () => exists });
  const created = await service.create({ cwd: directory, kind: 'claude' });
  assert.equal(processes[0].input.claudeSessionId, created.id); assert.equal(processes[0].input.resume, false);
  assert.equal(terminalLaunch({ ...processes[0].input, platform: 'darwin' }).args[1], `claude --session-id ${created.id}`);
  processes[0].exit(); exists = true;
  assert.equal((await service.open({ id: created.id })).status, 'exited');
  const restarted = await service.start({ id: created.id });
  assert.notEqual(restarted.runtimeSessionId, created.runtimeSessionId);
  assert.equal(processes[1].input.claudeSessionId, created.id); assert.equal(processes[1].input.resume, true);
  assert.equal(terminalLaunch({ ...processes[1].input, platform: 'win32' }).args[3], `claude --resume ${created.id}`);
  assert.throws(() => terminalLaunch({ kind: 'claude', claudeSessionId: 'bad; command' }), { statusCode: 400 });
});

for (const operation of ['start', 'stop']) test(`${operation} returns authoritative metadata after concurrent rename/archive`, async t => {
  const { service, terminalService, directory } = await fixture(t);
  const created = await service.create({ cwd: directory });
  if (operation === 'start') await service.stop({ id: created.id });
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), pending = new Promise(resolve => { entered = resolve; });
  const method = operation === 'start' ? 'spawnProcess' : 'close';
  const original = terminalService[method].bind(terminalService);
  terminalService[method] = async (...args) => { entered(); await gate; return original(...args); };
  const mutation = service[operation]({ id: created.id }); await pending;
  await service.update({ id: created.id, expectedRevision: 1, title: '并发修改', archived: true });
  release(); const response = await mutation;
  assert.equal(response.title, '并发修改'); assert.equal(response.archived, true); assert.equal(response.revision, 2);
  assert.equal(response.status, operation === 'start' ? 'running' : 'stopped');
});
