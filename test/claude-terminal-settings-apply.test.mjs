import test from 'node:test';
import assert from 'node:assert/strict';
import { createClaudeSettingsApplier } from '../src/claude-terminal-settings-apply.mjs';
import { cleanTerminalInputLine, terminalInputLine, terminalInputLineView } from '../src/terminal-input-line.mjs';
import { TerminalService } from '../src/terminal-service.mjs';

const ID = 'conversation';
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
// A fake runtime whose input line follows every write, as TerminalService does; `type` is the person.
function fixture({ onDelay, closed = new Set() } = {}) {
  let time = 10000, timers = [], line = cleanTerminalInputLine();
  const writes = [], view = { runtimeId: 'pty-1', claudeStatus: 'idle' };
  const input = data => { line = terminalInputLine(line, data, time); return terminalInputLineView(line); };
  const applier = createClaudeSettingsApplier({ inspect: async () => view.gone ? null : { ...view, inputLine: terminalInputLineView(line) },
    write: (runtimeId, data) => { if (closed.has(runtimeId)) throw Error('终端进程已结束'); writes.push(`${runtimeId}:${data}`); return input(data); }, inputLine: () => terminalInputLineView(line),
    now: () => time, schedule: fn => { timers.push(fn); return fn; }, cancel: fn => { timers = timers.filter(item => item !== fn); },
    delay: async () => { await onDelay?.(); } });
  const flush = async () => { const due = timers; timers = []; for (const fn of due) fn(); await settle(); };
  const commands = () => writes.filter(item => !item.endsWith(':\r')).map(item => item.slice('pty-1:'.length).replace('\x1b[200~', '').replace('\x1b[201~', ''));
  const advance = ms => { time += ms; };
  return { applier, view, writes, flush, commands, advance, type: input, timers: () => timers.length };
}

test('a choice is typed into an idle Claude as paste + Enter, one command per quiet period', async () => {
  const { applier, writes, flush, commands, advance } = fixture();
  applier.launched(ID, 'pty-1', { model: 'opus', effort: 'high', ultracode: false });
  assert.equal(applier.request(ID, { model: 'sonnet', effort: 'max', ultracode: false }), true); assert.equal(applier.pending(ID), true);
  await flush();
  assert.deepEqual(writes, ['pty-1:\x1b[200~/model claude-sonnet-5-5\x1b[201~', 'pty-1:\r']);
  await flush(); assert.deepEqual(commands(), ['/model claude-sonnet-5-5'], 'our own Enter starts a new quiet period');
  advance(1500); await flush();
  assert.deepEqual(commands(), ['/model claude-sonnet-5-5', '/effort max']);
  assert.equal(applier.pending(ID), false); assert.equal(applier.settling(ID), true, 'read-back waits for the typed commands to land');
});

test('busy or waiting Claude, unsubmitted input or recent typing queue the change; the latest choice wins', async () => {
  const { applier, view, flush, commands, advance, type, timers } = fixture();
  applier.launched(ID, 'pty-1', { model: 'opus', effort: 'high', ultracode: false });
  view.claudeStatus = 'busy'; applier.request(ID, { model: 'opus', effort: 'low', ultracode: false }); await flush();
  assert.deepEqual(commands(), []); assert.equal(applier.pending(ID), true); assert.equal(timers(), 1, 'polls again later');
  applier.request(ID, { model: 'opus', effort: 'max', ultracode: false });
  view.claudeStatus = 'idle'; type('half'); advance(5000); await flush(); assert.deepEqual(commands(), []);
  type('\r'); await flush(); assert.deepEqual(commands(), [], 'waits for a quiet period after the last input');
  view.claudeStatus = null; advance(2000); await flush(); assert.deepEqual(commands(), [], 'unknown or waiting status is not idle');
  view.claudeStatus = 'idle'; await flush();
  assert.deepEqual(commands(), ['/effort max']); assert.equal(applier.pending(ID), false);
});

test('input that arrives during the submit delay cancels the Enter; the step is retried later', async () => {
  let fixtureRef;
  const { applier, flush, commands, writes, advance } = fixtureRef = fixture({ onDelay: () => { if (!fixtureRef.typed) { fixtureRef.typed = true; fixtureRef.type('fix'); } } });
  applier.launched(ID, 'pty-1', { model: 'opus', effort: 'high', ultracode: false });
  applier.request(ID, { model: 'sonnet', effort: 'high', ultracode: false }); await flush();
  assert.equal(writes.includes('pty-1:\r'), false, 'never presses Enter on a line someone is editing');
  assert.equal(applier.pending(ID), true);
  fixtureRef.type('\x03'); advance(1500); await flush();
  assert.deepEqual(commands(), ['/model claude-sonnet-5-5', '/model claude-sonnet-5-5']); assert.equal(writes.at(-1), 'pty-1:\r');
  assert.equal(applier.pending(ID), false);
});

test('ultracode is restored once after a launch, and not for attach or unchanged settings', async () => {
  const { applier, flush, commands } = fixture();
  applier.launched(ID, 'pty-1', { model: 'opus', effort: 'auto', ultracode: true }); await flush();
  assert.deepEqual(commands(), ['/effort ultracode']); await flush(); assert.deepEqual(commands(), ['/effort ultracode']);
  assert.equal(applier.request(ID, { model: 'opus', effort: 'auto', ultracode: true }), true); assert.equal(applier.pending(ID), false, 'nothing to type');
  assert.equal(applier.request('stopped-conversation', { model: 'opus', effort: 'auto', ultracode: true }), false, 'not running here: launch flags apply next time');
});

test('a replaced runtime drops the queue; a change seen inside Claude voids an older target', async () => {
  const { applier, view, flush, commands } = fixture();
  applier.launched(ID, 'pty-1', null); view.claudeStatus = 'busy';
  applier.request(ID, { model: 'sonnet', effort: 'auto', ultracode: false }); await flush();
  applier.observed(ID, { model: 'fable', effort: 'high', ultracode: false }); assert.equal(applier.pending(ID), false);
  applier.request(ID, { model: 'sonnet', effort: 'auto', ultracode: false }); view.runtimeId = 'pty-2'; view.claudeStatus = 'idle'; await flush();
  assert.deepEqual(commands(), []); assert.equal(applier.pending(ID), false);
  applier.launched(ID, 'pty-1', null); applier.request(ID, { model: 'sonnet', effort: 'auto', ultracode: false }); applier.stopped(ID); await flush();
  assert.deepEqual(commands(), []); assert.equal(applier.settling(ID), false);
});

test('a run left over from an old runtime never drops the new runtime\'s queue', async () => {
  let fixtureRef; const closed = new Set();
  const { applier, flush } = fixtureRef = fixture({ closed, onDelay: () => {
    if (fixtureRef.relaunched) return;
    fixtureRef.relaunched = true; closed.add('pty-1'); fixtureRef.view.runtimeId = 'pty-2';
    fixtureRef.applier.stopped(ID); fixtureRef.applier.launched(ID, 'pty-2', { model: 'opus', effort: 'auto', ultracode: true });
  } });
  applier.launched(ID, 'pty-1', { model: 'opus', effort: 'high', ultracode: false });
  applier.request(ID, { model: 'sonnet', effort: 'high', ultracode: false }); await flush();
  assert.equal(applier.pending(ID), true, 'the ultracode restore of the new runtime survives');
});

test('with a real TerminalService, a two-command change lands one quiet period apart', async t => {
  let time = 50000, timers = [];
  const written = [];
  const service = new TerminalService({ userHome: '/tmp', defaultCwd: '/tmp', validateCwd: async cwd => cwd, now: () => time,
    spawnProcess: async () => ({ write: data => written.push(data), resize() {}, onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), kill: async () => {} }) });
  t.after(() => service.dispose());
  const session = await service.create({ kind: 'claude' });
  const applier = createClaudeSettingsApplier({ inspect: async () => ({ runtimeId: session.id, claudeStatus: 'idle', inputLine: service.inputLine(session.id) }),
    write: (id, data) => service.write(id, data), inputLine: id => service.inputLine(id), now: () => time,
    schedule: fn => { timers.push(fn); return fn; }, cancel: fn => { timers = timers.filter(item => item !== fn); }, delay: async () => {} });
  const flush = async () => { const due = timers; timers = []; for (const fn of due) fn(); await settle(); };
  applier.launched(ID, session.id, { model: 'opus', effort: 'high', ultracode: false });
  applier.request(ID, { model: 'fable', effort: 'low', ultracode: false }); await flush();
  assert.deepEqual(written, ['\x1b[200~/model claude-fable-5-1\x1b[201~', '\r']);
  time += 1000; await flush(); assert.equal(written.length, 2);
  time += 500; await flush();
  assert.deepEqual(written.slice(2), ['\x1b[200~/effort low\x1b[201~', '\r']); assert.equal(applier.pending(ID), false);
});
