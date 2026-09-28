import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createClaudeSessionOccupancy } from '../src/claude-session-occupancy.mjs';
import { createClaudeSessionTakeover } from '../src/claude-session-takeover.mjs';
import { terminalStartInput } from '../src/terminal-conversation-contract.mjs';
import { TerminalService } from '../src/terminal-service.mjs';
import { TerminalConversationService } from '../src/terminal-conversation-service.mjs';

function processes(table) {
  const signals = [];
  return { signals, isAlive: pid => Boolean(table[pid]?.alive), command: async pid => (table[pid]?.alive ? table[pid].command : ''),
    signal(pid, name) { signals.push([pid, name]); if (table[pid].dies?.includes(name)) table[pid].alive = false; },
    holders: async () => Object.entries(table).filter(([, item]) => item.holds && item.alive).map(([pid, item]) => ({ pid: Number(pid), sessionId: 'x', ...(item.jobId ? { jobId: item.jobId } : {}) })) };
}
const fast = { sleep: async () => {}, graceMs: 300, pollMs: 100 };

test('takeover sends SIGTERM to every verified Claude holder and stops once they exit', async () => {
  const world = processes({ 10: { alive: true, holds: true, command: 'claude bg-spare', dies: ['SIGTERM'] },
    11: { alive: true, holds: true, command: '/Users/dev/.local/bin/claude.exe', dies: ['SIGTERM'] } });
  const takeover = createClaudeSessionTakeover({ ...world, ...fast });
  assert.deepEqual(await takeover(['x']), [10, 11]);
  assert.deepEqual(world.signals, [[10, 'SIGTERM'], [11, 'SIGTERM']]);
});

test('takeover escalates to SIGKILL only after the grace period', async () => {
  const world = processes({ 20: { alive: true, holds: true, command: 'claude', dies: ['SIGKILL'] } });
  assert.deepEqual(await createClaudeSessionTakeover({ ...world, ...fast })(['x']), [20]);
  assert.deepEqual(world.signals, [[20, 'SIGTERM'], [20, 'SIGKILL']]);
});

test('a daemon-hosted holder is stopped through claude stop and never signalled', async () => {
  const table = { 70: { alive: true, holds: true, command: 'claude bg-spare', jobId: '13649afa' }, 71: { alive: true, holds: true, command: 'claude', dies: ['SIGTERM'] } };
  const world = processes(table), stopped = [];
  const stopJob = async jobId => { stopped.push(jobId); table[70].alive = false; };
  assert.deepEqual(await createClaudeSessionTakeover({ ...world, stopJob, ...fast })(['x']), [70, 71]);
  assert.deepEqual(stopped, ['13649afa']); assert.deepEqual(world.signals, [[71, 'SIGTERM']]);
});

test('a failed claude stop aborts the takeover before any signal', async () => {
  const world = processes({ 80: { alive: true, holds: true, command: 'claude bg-spare', jobId: 'abcdef01' }, 81: { alive: true, holds: true, command: 'claude', dies: ['SIGTERM'] } });
  const stopJob = async () => { throw Error('daemon unavailable'); };
  await assert.rejects(createClaudeSessionTakeover({ ...world, stopJob, ...fast })(['x']), { statusCode: 409, message: /无法停止 Claude 后台会话 abcdef01/ });
  assert.deepEqual(world.signals, []);
});

test('takeover refuses without signalling when any holder is not a verifiable Claude process', async () => {
  const world = processes({ 30: { alive: true, holds: true, command: 'claude', dies: ['SIGTERM'] }, 31: { alive: true, holds: true, command: 'Safari' } });
  await assert.rejects(createClaudeSessionTakeover({ ...world, ...fast })(['x']), { statusCode: 409, message: /无法核实为 Claude/ });
  assert.deepEqual(world.signals, []);
});

test('takeover never signals a pid that was reused by another program before the signal', async () => {
  const table = { 40: { alive: true, holds: true, command: 'claude' } }, world = processes(table);
  let checks = 0; const command = async pid => (++checks > 1 ? 'Finder' : table[pid].command);
  await assert.rejects(createClaudeSessionTakeover({ ...world, command, ...fast })(['x']), { statusCode: 409, message: /无法结束/ });
  assert.deepEqual(world.signals, []);
});

test('takeover reports a holder that reappears after the others exit', async () => {
  const table = { 50: { alive: true, holds: true, command: 'claude', dies: ['SIGTERM'] } }, world = processes(table);
  const holders = async ids => { const found = await world.holders(ids); return found.length ? found : [{ pid: 51, sessionId: 'x' }]; };
  table[51] = { alive: true, command: 'claude' };
  await assert.rejects(createClaudeSessionTakeover({ ...world, holders, ...fast })(['x']), /无法核实|又被其他/);
});

test('occupancy lists every live holder freshly for takeover', async t => {
  const userHome = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-takeover-')); t.after(() => fs.rm(userHome, { recursive: true, force: true }));
  const sessions = path.join(userHome, '.claude', 'sessions'); await fs.mkdir(sessions, { recursive: true });
  await fs.writeFile(path.join(sessions, '61.json'), JSON.stringify({ pid: 61, sessionId: 'a' }));
  const occupancy = createClaudeSessionOccupancy({ userHome, isAlive: () => true, now: () => 0 });
  assert.equal((await occupancy(['a', 'b'])).pid, 61);
  await fs.writeFile(path.join(sessions, '62.json'), JSON.stringify({ pid: 62, sessionId: 'b', kind: 'bg', jobId: 'abcdef01' }));
  await fs.writeFile(path.join(sessions, '63.json'), JSON.stringify({ pid: 63, sessionId: 'b', kind: 'bg', jobId: 'x; rm -rf ~' }));
  const all = (await occupancy.all(['a', 'b'])).sort((l, r) => l.pid - r.pid);
  assert.deepEqual(all.map(item => item.pid), [61, 62, 63], 'the takeover listing bypasses the cache');
  assert.equal(all[1].jobId, 'abcdef01'); assert.equal(all[2].jobId, undefined, 'a malformed job id is never passed on');
});

test('start input accepts only a literal boolean takeover flag', () => {
  const id = '23cabe86-915e-4cdd-adf4-17f6fce4f537';
  assert.deepEqual(terminalStartInput({ id }), { id, takeover: false });
  assert.deepEqual(terminalStartInput({ id, takeover: true }), { id, takeover: true });
  assert.throws(() => terminalStartInput({ id, takeover: 'yes' }), { statusCode: 400 });
  assert.throws(() => terminalStartInput({ id, force: true }), { statusCode: 400 });
});

test('the service takes over only on an explicit request and then resumes here', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-takeover-service-'));
  const spawned = [];
  const terminalService = new TerminalService({ userHome: directory, defaultCwd: directory, spawnProcess: async input => { spawned.push(input); return { onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), kill: async () => {}, write() {}, resize() {} }; } });
  t.after(async () => { await terminalService.dispose(); await fs.rm(directory, { recursive: true, force: true }); });
  let occupant = null; const takeovers = [];
  const service = new TerminalConversationService({ terminalService, filePath: path.join(directory, 'registry.json'), deviceId: 'mac',
    claudeTranscripts: { summary: async id => ({ title: '', lastUserMessageAt: null, ids: [id, 'continuation'] }), search: async () => null },
    claudeOccupancy: async () => occupant, claudeTakeover: async ids => { takeovers.push(ids); occupant = null; return [4242]; } });
  const created = await service.create({ cwd: directory, kind: 'claude' });
  await service.stop({ id: created.id }); occupant = { pid: 4242, sessionId: 'continuation' };
  const before = spawned.length;
  await assert.rejects(service.start({ id: created.id }), { statusCode: 409 });
  assert.deepEqual(takeovers, [], 'a plain start never terminates anything');
  assert.equal((await service.start({ id: created.id, takeover: true })).status, 'running');
  assert.deepEqual(takeovers, [[created.id, 'continuation']]); assert.equal(spawned.length, before + 1);
});

test('starting resumes the live transcript of the chain, never the stale managed id', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-resume-live-'));
  const spawned = [], live = '13649afa-75c9-4f75-9acf-3e65689fa832';
  const terminalService = new TerminalService({ userHome: directory, defaultCwd: directory, spawnProcess: async input => { spawned.push(input); return { onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), kill: async () => {}, write() {}, resize() {} }; } });
  t.after(async () => { await terminalService.dispose(); await fs.rm(directory, { recursive: true, force: true }); });
  let resumeId = null;
  const service = new TerminalConversationService({ terminalService, filePath: path.join(directory, 'registry.json'), deviceId: 'mac',
    claudeTranscripts: { summary: async id => ({ title: '', lastUserMessageAt: null, ids: [id, live], resumeId }), search: async () => null },
    claudeOccupancy: async () => null, transcriptExists: async ({ sessionId }) => sessionId === live });
  const created = await service.create({ cwd: directory, kind: 'claude' });
  assert.equal(spawned.at(-1).claudeSessionId, created.id, 'a brand-new conversation starts under its managed id');
  await service.stop({ id: created.id }); resumeId = live;
  await service.start({ id: created.id });
  assert.equal(spawned.at(-1).claudeSessionId, live); assert.equal(spawned.at(-1).resume, true);
});

test('a session held only by Claude background jobs is attached and shared, never stopped', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-attach-'));
  const spawned = [], live = '13649afa-75c9-4f75-9acf-3e65689fa832';
  const terminalService = new TerminalService({ userHome: directory, defaultCwd: directory, spawnProcess: async input => { spawned.push(input); return { onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), kill: async () => {}, write() {}, resize() {} }; } });
  t.after(async () => { await terminalService.dispose(); await fs.rm(directory, { recursive: true, force: true }); });
  let held = [], takeovers = 0;
  const occupancy = async () => held[0] || null; occupancy.all = async () => held;
  const service = new TerminalConversationService({ terminalService, filePath: path.join(directory, 'registry.json'), deviceId: 'mac',
    claudeTranscripts: { summary: async id => ({ title: '', lastUserMessageAt: null, ids: [id, live, 'fork'], resumeId: live }), search: async () => null },
    claudeOccupancy: occupancy, claudeTakeover: async () => { takeovers++; }, transcriptExists: async () => true });
  const created = await service.create({ cwd: directory, kind: 'claude' });
  await service.stop({ id: created.id });
  held = [{ pid: 7, sessionId: 'fork', jobId: '846a6733' }, { pid: 8, sessionId: live, jobId: '13649afa' }];
  const viewed = await service.open({ id: created.id });
  assert.equal(viewed.occupiedElsewhere, true); assert.equal(viewed.occupiedBy, 'background');
  assert.equal((await service.start({ id: created.id })).status, 'running');
  assert.equal(spawned.at(-1).attachJob, '13649afa', 'attaches to the job running the live transcript');
  assert.equal(spawned.at(-1).claudeSessionId, undefined); assert.equal(takeovers, 0);
  await service.stop({ id: created.id });
  held = [{ pid: 8, sessionId: live, jobId: '13649afa' }, { pid: 9, sessionId: live }];
  assert.equal((await service.open({ id: created.id })).occupiedBy, 'terminal', 'any terminal-window holder needs a takeover');
  await assert.rejects(service.start({ id: created.id }), { statusCode: 409 }); assert.equal(takeovers, 0);
});
