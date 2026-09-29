import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createClaudeSessionOccupancy } from '../src/claude-session-occupancy.mjs';
import { TerminalService } from '../src/terminal-service.mjs';
import { TerminalConversationService } from '../src/terminal-conversation-service.mjs';

test('a live Claude registration for any id in the chain marks the session occupied; keys and dead processes are ignored', async t => {
  const userHome = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-occupancy-'));
  t.after(() => fs.rm(userHome, { recursive: true, force: true }));
  const sessions = path.join(userHome, '.claude', 'sessions'); await fs.mkdir(sessions, { recursive: true });
  await fs.writeFile(path.join(sessions, '101.json'), JSON.stringify({ pid: 101, sessionId: 'AAAA-live', startedAt: 1790694773928 }));
  await fs.writeFile(path.join(sessions, '202.json'), JSON.stringify({ pid: 202, sessionId: 'dead' }));
  await fs.writeFile(path.join(sessions, '303.json'), JSON.stringify({ pid: 999, sessionId: 'mismatched-name' }));
  await fs.writeFile(path.join(sessions, '404.abc.key'), 'secret-material');
  await fs.writeFile(path.join(sessions, '505.json'), '{broken');
  let reads = 0; const alive = pid => { reads++; return pid !== 202; };
  let clock = 0;
  const occupiedBy = createClaudeSessionOccupancy({ userHome, isAlive: alive, now: () => clock });
  assert.deepEqual(await occupiedBy(['other', 'aaaa-live']), { pid: 101, sessionId: 'aaaa-live', startedAt: 1790694773928 });
  assert.equal(await occupiedBy(['dead']), null, 'a registration whose process exited is free');
  assert.equal(await occupiedBy(['mismatched-name']), null, 'the file name must match its pid');
  await fs.rm(path.join(sessions, '101.json'));
  assert.ok(await occupiedBy(['aaaa-live']), 'listing is cached briefly'); clock = 5000;
  assert.equal(await occupiedBy(['aaaa-live']), null);
  assert.equal(await createClaudeSessionOccupancy({ userHome: path.join(userHome, 'missing') })(['x']), null);
});

test('an occupied Claude conversation is read-only: flagged in views and refused on start', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-occupied-service-'));
  const spawned = [];
  const terminalService = new TerminalService({ userHome: directory, defaultCwd: directory, spawnProcess: async input => { spawned.push(input); return { onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), kill: async () => {}, write() {}, resize() {} }; } });
  t.after(async () => { await terminalService.dispose(); await fs.rm(directory, { recursive: true, force: true }); });
  let occupant = null; const asked = [];
  const service = new TerminalConversationService({ terminalService, filePath: path.join(directory, 'registry.json'), deviceId: 'mac',
    claudeTranscripts: { summary: async id => ({ title: '', lastUserMessageAt: null, ids: [id, 'continuation'] }), search: async () => null },
    claudeOccupancy: async ids => { asked.push(ids); return occupant; } });
  const created = await service.create({ cwd: directory, kind: 'claude' });
  assert.equal(created.occupiedElsewhere, false, 'our own running process is not "elsewhere"');
  await service.stop({ id: created.id }); occupant = { pid: 4242, sessionId: 'continuation' };
  const viewed = await service.open({ id: created.id });
  assert.equal(viewed.occupiedElsewhere, true); assert.deepEqual(asked.at(-1), [created.id, 'continuation']);
  const before = spawned.length;
  await assert.rejects(service.start({ id: created.id }), { statusCode: 409, message: /其他 Claude 窗口中运行（进程 4242）/ });
  assert.equal(spawned.length, before, 'no second Claude process is spawned');
  occupant = null; assert.equal((await service.start({ id: created.id })).status, 'running');
});
