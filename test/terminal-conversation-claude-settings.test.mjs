import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TerminalService } from '../src/terminal-service.mjs';
import { TerminalConversationService } from '../src/terminal-conversation-service.mjs';
import { terminalLaunch } from '../src/terminal-process.mjs';
import { projectTerminalConversations } from '../src/terminal-conversation-projection.mjs';

const SESSION = '33333333-3333-4333-8333-333333333333';

async function fixture(t, overrides = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-settings-service-'));
  const processes = [], calls = [];
  const terminalService = new TerminalService({ userHome: directory, defaultCwd: directory,
    spawnProcess: async input => {
      const listeners = {}, process = { input, written: [], onData: () => ({ dispose() {} }), onExit: listener => { listeners.exit = listener; return { dispose() {} }; },
        kill: async () => {}, write: data => process.written.push(data), resize() {}, exit: () => listeners.exit({ exitCode: 0 }) };
      processes.push(process); return process;
    } });
  const claudeSettings = { launched: (...args) => calls.push(['launched', ...args]), request: (...args) => { calls.push(['request', ...args]); return true; },
    observed: (...args) => calls.push(['observed', ...args]), stopped: id => calls.push(['stopped', id]), pending: () => false, settling: () => false };
  const service = new TerminalConversationService({ terminalService, filePath: path.join(directory, 'registry.json'), deviceId: 'device',
    transcriptExists: async () => false, claudeOccupancy: Object.assign(async () => null, { all: async () => [] }), claudeSettings,
    now: () => new Date('2026-09-29T10:00:00.000Z'), ...overrides });
  t.after(async () => { await terminalService.dispose(); await fs.rm(directory, { recursive: true, force: true }); });
  return { service, terminalService, directory, processes, calls };
}

test('launch passes --model/--effort before the session flag; attach and shell take none; unsafe values are refused', () => {
  const launch = (options, platform = 'darwin') => terminalLaunch({ kind: 'claude', platform, env: { SHELL: '/bin/zsh' }, ...options }).args.at(-1);
  assert.match(launch({ claudeSessionId: SESSION, resume: true, claudeSettings: { model: 'opus-1m', effort: 'high' } }),
    new RegExp(`^claude --permission-mode bypassPermissions --append-system-prompt .+ --model 'opus\\[1m\\]' --effort 'high' --resume ${SESSION}$`, 'u'));
  assert.equal(launch({ claudeSessionId: SESSION, claudeSettings: { model: 'haiku', effort: 'auto' } }, 'win32'),
    `claude --permission-mode bypassPermissions --model claude-haiku-4-5-20251001 --session-id ${SESSION}`);
  assert.equal(launch({ attachJob: '13649afa', claudeSettings: { model: 'opus', effort: 'max' } }), 'claude attach 13649afa');
  assert.deepEqual(terminalLaunch({ kind: 'shell', platform: 'linux', env: { SHELL: '/bin/bash' }, claudeSettings: { model: 'opus', effort: 'max' } }).args, ['-l']);
  for (const platform of ['darwin', 'win32']) assert.throws(() => launch({ claudeSessionId: SESSION, claudeSettings: { model: 'opus & calc', effort: 'auto' } }, platform), { statusCode: 400 });
  assert.throws(() => launch({ claudeSessionId: SESSION, claudeSettings: { model: 'opus', effort: '--dangerously' } }), { statusCode: 400 });
});

test('a stored choice is saved with its time, passed to the next launch and queued for a running Claude', async t => {
  const { service, directory, processes, calls } = await fixture(t);
  const created = await service.create({ cwd: directory, kind: 'claude' });
  assert.equal(processes[0].input.claudeSettings, null); assert.deepEqual(calls.at(-1), ['launched', created.id, created.runtimeSessionId, null]);
  assert.equal(created.claudeSettingsReadOnly, null); assert.equal(created.claudeObserved, null);
  const updated = await service.update({ id: created.id, expectedRevision: 1, claudeSettings: { model: 'sonnet', effort: 'max', ultracode: true } });
  const saved = { model: 'sonnet', effort: 'max', ultracode: true, updatedAt: '2026-09-29T10:00:00.000Z' };
  assert.deepEqual(updated.claudeSettings, saved); assert.deepEqual(calls.at(-1), ['request', created.id, saved]);
  await service.stop({ id: created.id }); assert.deepEqual(calls.at(-1), ['stopped', created.id]);
  const restarted = await service.start({ id: created.id });
  assert.deepEqual(processes[1].input.claudeSettings, saved);
  assert.deepEqual(calls.at(-1), ['launched', created.id, restarted.runtimeSessionId, saved], 'ultracode is restored by the applier after launch');
  const board = projectTerminalConversations({ tasks: [], devices: [] }, { deviceId: 'device', conversations: [updated] }, { name: 'Mac' });
  assert.deepEqual([board.tasks[0].model, board.tasks[0].reasoningEffort], ['claude-sonnet-5-5', 'max']);
  const unset = projectTerminalConversations({ tasks: [], devices: [] }, { deviceId: 'device', conversations: [{ ...updated, claudeSettings: { ...saved, model: null, effort: 'high' } }] }, { name: 'Mac' });
  assert.deepEqual([unset.tasks[0].model, unset.tasks[0].reasoningEffort], [null, 'high']);
  const shell = await service.create({ cwd: directory, kind: 'shell' });
  await assert.rejects(service.update({ id: shell.id, expectedRevision: 1, claudeSettings: { model: 'opus', effort: 'auto', ultracode: false } }), { statusCode: 400 });
});

test('companion and attached sessions are read-only for the model choice', async t => {
  const holders = [];
  const { service, directory, calls } = await fixture(t, { claudeOccupancy: Object.assign(async () => null, { all: async () => holders }),
    claudeTranscripts: { summary: async id => ({ title: '', ids: [id], resumeId: null }), search: async () => null } });
  const created = await service.create({ cwd: directory, kind: 'claude' }); await service.stop({ id: created.id });
  holders.push({ pid: 99, sessionId: created.id, jobId: 'abcdef12', status: 'idle' });
  const attached = await service.start({ id: created.id });
  assert.equal(attached.claudeSettingsReadOnly, 'attach'); assert.deepEqual(calls.at(-1), ['stopped', created.id]);
  await assert.rejects(service.update({ id: created.id, expectedRevision: 1, claudeSettings: { model: 'opus', effort: 'auto', ultracode: false } }), { statusCode: 409 });
  const companion = await service.store.adopt({ id: SESSION, cwd: directory, kind: 'claude', title: 'Claude CLI', projectRef: null, companionOf: created.id });
  assert.equal((await service.open({ id: companion.id })).claudeSettingsReadOnly, 'companion');
  await assert.rejects(service.update({ id: companion.id, expectedRevision: 1, claudeSettings: { model: 'opus', effort: 'auto', ultracode: false } }), { statusCode: 409 });
});

test('a newer change made inside Claude is written back once; older evidence and pending changes are left alone', async t => {
  let settings = {}, settling = false;
  const { service, directory, calls } = await fixture(t, { claudeTranscripts: { summary: async id => ({ title: '', ids: [id], resumeId: null, settings }), search: async () => null } });
  service.claudeSettings.settling = () => settling;
  const created = await service.create({ cwd: directory, kind: 'claude' });
  settings = { assistant: { model: 'claude-opus-5-5', effort: 'medium', at: '2026-09-29T09:00:00.000Z' } };
  const observedOnly = await service.open({ id: created.id });
  assert.deepEqual(observedOnly.claudeObserved, { model: 'opus', effort: 'medium', ultracode: null }); assert.equal(observedOnly.revision, 1, 'no choice stored: nothing written');
  await service.update({ id: created.id, expectedRevision: 1, claudeSettings: { model: 'opus-latest', effort: 'auto', ultracode: false } });
  settings = { assistant: { model: 'claude-opus-5-5', effort: 'high', at: '2026-09-29T10:05:00.000Z' }, effortCommand: { value: 'low', at: '2026-09-29T10:04:00.000Z' } };
  settling = true; assert.equal((await service.open({ id: created.id })).revision, 2, 'a queued or just-typed change defers read-back');
  const before = await service.store.get(created.id);
  settling = false; const synced = await service.open({ id: created.id });
  assert.deepEqual(synced.claudeSettings, { model: 'opus-latest', effort: 'high', ultracode: false, updatedAt: '2026-09-29T10:05:00.000Z' });
  assert.equal(synced.updatedAt, before.updatedAt, 'a read-back does not move the conversation up the list');
  assert.equal(synced.revision, 3); assert.deepEqual(calls.at(-1), ['observed', created.id, synced.claudeSettings]);
  assert.equal((await service.open({ id: created.id })).revision, 3, 'the same evidence is not adopted twice');
});

test('the applier sees only our own running Claude, its registered status and input line', async t => {
  const holders = [];
  const { service, directory, terminalService } = await fixture(t, { claudeOccupancy: Object.assign(async () => null, { all: async () => holders }),
    claudeTranscripts: { summary: async id => ({ title: '', ids: [id], resumeId: null }), search: async () => null } });
  const created = await service.create({ cwd: directory, kind: 'claude' });
  holders.push({ pid: 42, sessionId: created.id, status: 'idle' });
  assert.deepEqual(await service.claudeRuntimeState(created.id), { runtimeId: created.runtimeSessionId, claudeStatus: 'idle', inputLine: { dirty: false, at: 0, seq: 0 } });
  holders.push({ pid: 43, sessionId: created.id });
  assert.equal((await service.claudeRuntimeState(created.id)).claudeStatus, null, 'a holder reporting "waiting" (menu, dialog) is not idle');
  holders.pop();
  terminalService.connect(created.runtimeSessionId, { send() {}, close() {} }).receive({ type: 'input', data: '/mo' });
  holders[0].status = 'busy';
  const state = await service.claudeRuntimeState(created.id);
  assert.equal(state.claudeStatus, 'busy'); assert.equal(state.inputLine.dirty, true);
  await service.stop({ id: created.id }); assert.equal(await service.claudeRuntimeState(created.id), null);
  holders.splice(0, holders.length, { pid: 44, sessionId: created.id, jobId: 'abcdef12', status: 'idle' });
  await service.start({ id: created.id }); assert.equal(await service.claudeRuntimeState(created.id), null, 'an attached background session is not ours to type into');
});

test('a choice made while the session is held by another Claude process is refused', async t => {
  const holders = [];
  const { service, directory } = await fixture(t, { claudeOccupancy: Object.assign(async () => null, { all: async () => holders }),
    claudeTranscripts: { summary: async id => ({ title: '', ids: [id], resumeId: null }), search: async () => null } });
  const created = await service.create({ cwd: directory, kind: 'claude' }); await service.stop({ id: created.id });
  holders.push({ pid: 99, sessionId: created.id, status: 'idle' });
  assert.equal((await service.open({ id: created.id })).claudeSettingsReadOnly, 'elsewhere');
  await assert.rejects(service.update({ id: created.id, expectedRevision: 1, claudeSettings: { model: 'sonnet', effort: 'auto', ultracode: false } }), { statusCode: 409 });
  assert.equal((await service.update({ id: created.id, expectedRevision: 1, title: 'Renamed' })).title, 'Renamed', 'other edits are unaffected');
});

test('a choice made while a start is still launching is queued for the Claude it launched', async t => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const { service, directory, calls, processes } = await fixture(t);
  const created = await service.create({ cwd: directory, kind: 'claude' }); await service.stop({ id: created.id });
  const spawn = service.terminalService.spawnProcess;
  service.terminalService.spawnProcess = async input => { await gate; return spawn(input); };
  const starting = service.start({ id: created.id });
  const updating = service.update({ id: created.id, expectedRevision: 1, claudeSettings: { model: 'sonnet', effort: 'auto', ultracode: false } });
  // Give an unserialized update every chance to land mid-launch (it would store revision 2 first).
  for (let i = 0; i < 40 && (await service.store.get(created.id)).revision === 1; i++) await new Promise(resolve => setTimeout(resolve, 10));
  release();
  const [started, updated] = await Promise.all([starting, updating]);
  assert.equal(processes.at(-1).input.claudeSettings, null, 'the launch used the choice stored when it began');
  assert.deepEqual(calls.slice(-2).map(call => call[0]), ['launched', 'request'], 'the choice arrives after the launch registered');
  assert.equal(calls.at(-1)[1], created.id); assert.equal(started.runtimeSessionId, updated.runtimeSessionId);
});

test('a stored choice the catalog no longer offers never makes the registry unreadable', async t => {
  const { service, directory } = await fixture(t);
  const created = await service.create({ cwd: directory, kind: 'claude' }); await service.stop({ id: created.id });
  const file = path.join(directory, 'registry.json'), registry = JSON.parse(await fs.readFile(file, 'utf8'));
  registry.conversations[0].claudeSettings = { model: 'retired-model', effort: 'high', ultracode: false, updatedAt: '2026-09-29T09:00:00.000Z' };
  await fs.writeFile(file, JSON.stringify(registry));
  const reloaded = new TerminalConversationService({ terminalService: service.terminalService, filePath: file, deviceId: 'device', claudeSettings: service.claudeSettings,
    transcriptExists: async () => false, claudeOccupancy: Object.assign(async () => null, { all: async () => [] }) });
  const [record] = (await reloaded.list()).conversations;
  assert.equal(record.id, created.id); assert.equal(record.claudeSettings, undefined);
});
