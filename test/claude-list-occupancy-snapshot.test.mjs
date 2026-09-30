import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createClaudeSessionOccupancy } from '../src/claude-session-occupancy.mjs';
import { TerminalConversationService } from '../src/terminal-conversation-service.mjs';
import { createClaudeMirrorTurns } from '../src/claude-mirror-turn.mjs';

const sessionId = number => `11111111-1111-4111-8111-${String(number).padStart(12, '0')}`;

function fixture({ recordCount = 20, registrationCount = 4 } = {}) {
  const counts = { realpath: 0, readdir: 0, lstat: 0, readFile: 0, snapshots: 0, spawn: 0, write: 0 };
  const registrations = new Map(), live = new Set(), runtimeSessions = [];
  const records = Array.from({ length: recordCount }, (_, index) => ({ id: sessionId(index + 1), kind: 'claude', title: 'Claude CLI', revision: 1, cwd: '/synthetic' }));
  for (let index = 1; index <= registrationCount; index++) {
    registrations.set(`${100 + index}.json`, { pid: 100 + index, sessionId: sessionId(index), status: 'idle' });
    live.add(100 + index);
  }
  let fails = false, missing = false;
  const fsImpl = {
    async realpath(file) { counts.realpath++; if (missing) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return file; },
    async readdir() { counts.readdir++; if (fails) throw new Error('unreadable registrations'); return [...registrations.keys(), '404.secret.key', 'other.json']; },
    async lstat() { counts.lstat++; return { isFile: () => true, size: 100 }; },
    async readFile(file) {
      counts.readFile++; const name = path.basename(file);
      assert.match(name, /^\d{1,10}\.json$/, 'only bounded numeric registration JSON may be read');
      const value = registrations.get(name); return typeof value === 'string' ? value : JSON.stringify(value);
    }
  };
  const occupancy = createClaudeSessionOccupancy({ userHome: '/synthetic-home', fsImpl, isAlive: pid => live.has(pid), now: () => 0 });
  const snapshot = occupancy.snapshot;
  occupancy.snapshot = async () => { counts.snapshots++; return snapshot(); };
  const terminalService = { defaultCwd: '/synthetic', userHome: '/synthetic-home', list: () => ({ sessions: runtimeSessions }),
    createManaged: async () => { counts.spawn++; throw new Error('synthetic test must not launch'); },
    write: () => { counts.write++; }, inputLine: () => ({ dirty: true, at: 0, seq: 1 }) };
  const service = new TerminalConversationService({ terminalService, deviceId: 'synthetic', claudeOccupancy: occupancy,
    transcriptExists: async () => false, claudeTakeover: async () => { throw new Error('synthetic test must not stop a process'); },
    store: { list: async () => records, get: async id => records.find(record => record.id === id) },
    claudeTranscripts: { summary: async id => ({ title: '', ids: [id], resumeId: null }), search: async () => null },
    mirrorTurns: { state: () => null, send: () => { throw new Error('not configured'); } } });
  return { service, occupancy, registrations, live, records, runtimeSessions, counts,
    fail(value) { fails = value; }, missing(value) { missing = value; } };
}

test('one Claude listing shares one fresh registration scan and the next listing scans again', async () => {
  const f = fixture();
  const first = await f.service.list();
  assert.equal(first.conversations.length, 20); assert.equal(first.conversations[0].claudeStatus, 'idle');
  assert.deepEqual(f.counts, { realpath: 2, readdir: 1, lstat: 4, readFile: 4, snapshots: 1, spawn: 0, write: 0 });
  f.registrations.get('101.json').status = 'busy';
  const second = await f.service.list();
  assert.equal(second.conversations[0].claudeStatus, 'busy', 'the next list bypasses the existing non-action TTL cache');
  assert.deepEqual(f.counts, { realpath: 4, readdir: 2, lstat: 8, readFile: 8, snapshots: 2, spawn: 0, write: 0 });
});

test('listing snapshots filter continuation IDs and check current liveness for every row', async () => {
  const f = fixture({ recordCount: 2, registrationCount: 1 });
  f.registrations.get('101.json').sessionId = sessionId(99);
  let releaseSecond;
  const secondReady = new Promise(resolve => { releaseSecond = resolve; });
  const snapshot = f.occupancy.snapshot;
  f.occupancy.snapshot = async () => {
    const read = await snapshot();
    return ids => { const values = read(ids); f.live.delete(101); releaseSecond(); return values; };
  };
  f.service.claudeTranscripts.summary = async id => {
    if (id === sessionId(2)) await secondReady;
    return { title: '', ids: [id, sessionId(99)] };
  };
  const { conversations } = await f.service.list();
  assert.equal(conversations[0].occupiedElsewhere, true);
  assert.equal(conversations[1].occupiedElsewhere, false, 'the second row does not retain a dead PID from the snapshot');
  assert.equal(f.counts.readdir, 1);
});

test('snapshot projection cannot mutate its registrations and legacy custom readers keep their fallback', async () => {
  const f = fixture({ recordCount: 2, registrationCount: 1 });
  const read = await f.occupancy.snapshot();
  const first = read([sessionId(1)]); first[0].status = 'busy'; first.pop();
  assert.equal(read([sessionId(1)])[0].status, 'idle');
  for (const withAll of [false, true]) {
    let calls = 0;
    const custom = async ids => { calls++; return { pid: 7, sessionId: ids[0], status: 'idle' }; };
    if (withAll) custom.all = async ids => { calls++; return [{ pid: 7, sessionId: ids[0], status: 'idle' }]; };
    f.service.claudeOccupancy = custom;
    assert.deepEqual((await f.service.list()).conversations.map(row => row.claudeStatus), ['idle', 'idle']);
    assert.equal(calls, 2, 'a custom reader without the snapshot capability follows the original per-row path');
  }
});

test('missing directories and failed scans degrade this list only and retry on the next list', async () => {
  const f = fixture({ recordCount: 3, registrationCount: 1 });
  f.missing(true); assert.equal((await f.service.list()).conversations[0].occupiedElsewhere, false);
  f.missing(false); assert.equal((await f.service.list()).conversations[0].occupiedElsewhere, true);
  f.fail(true); const failed = await f.service.list();
  assert.equal(failed.conversations.length, 3); assert.equal(failed.conversations[0].claudeStatus, null);
  f.fail(false); assert.equal((await f.service.list()).conversations[0].claudeStatus, 'idle');
  assert.equal(f.counts.snapshots, 4, 'each list owns a new snapshot, including after failure');
  f.registrations.set('101.json', '{being rewritten');
  assert.equal((await f.service.list()).conversations[0].occupiedElsewhere, false);
  f.registrations.set('101.json', { pid: 101, sessionId: sessionId(1), status: 'busy' });
  assert.equal((await f.service.list()).conversations[0].claudeStatus, 'busy');
});

test('synchronous snapshot and asynchronous row failures retain per-row degradation without unhandled rejection', async () => {
  const f = fixture({ recordCount: 3, registrationCount: 0 }), unhandled = [];
  const receive = error => unhandled.push(error); process.on('unhandledRejection', receive);
  try {
    let calls = 0;
    f.occupancy.snapshot = () => { calls++; throw new Error('sync snapshot failure'); };
    assert.equal((await f.service.list()).conversations.length, 3); assert.equal(calls, 1);
    f.occupancy.snapshot = async () => async () => { throw new Error('row projection failed'); };
    assert.equal((await f.service.list()).conversations.every(row => row.occupiedElsewhere === false), true);
    await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(unhandled, []);
  } finally { process.removeListener('unhandledRejection', receive); }
});

test('an unoccupied list never authorizes later start, settings or mirror input', async () => {
  const f = fixture({ recordCount: 2, registrationCount: 0 });
  f.records[1].companionOf = sessionId(77);
  assert.equal((await f.service.list()).conversations[0].occupiedElsewhere, false);
  f.registrations.set('101.json', { pid: 101, sessionId: sessionId(1), status: 'busy' }); f.live.add(101);
  await assert.rejects(f.service.start({ id: sessionId(1) }), { statusCode: 409 });
  await assert.rejects(f.service.update({ id: sessionId(1), expectedRevision: 1,
    claudeSettings: { model: 'sonnet', effort: 'auto', ultracode: false } }), { statusCode: 409 });
  f.runtimeSessions.push({ id: 'managed', status: 'running' }); f.service.runtimes.set(sessionId(1), 'managed');
  assert.equal((await f.service.claudeRuntimeState(sessionId(1))).claudeStatus, 'busy');
  assert.equal((await f.service.claudeRuntimeState(sessionId(1))).inputLine.dirty, true);
  f.registrations.set('102.json', { pid: 102, sessionId: sessionId(2), status: 'idle' }); f.live.add(102);
  f.service.mirrorTurns = createClaudeMirrorTurns({ userHome: '/synthetic-home', holders: ids => f.service.holders(ids),
    spawn: () => { f.counts.spawn++; throw new Error('must not spawn'); } });
  await f.service.mirrorSend({ id: sessionId(2), text: 'synthetic input' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.service.mirrorTurns.state(sessionId(2)).state, 'failed', 'fresh interactive occupancy refuses the queued mirror input');
  assert.equal(f.counts.snapshots, 1, 'actions never consult the completed list snapshot');
  assert.equal(f.counts.readdir, 6, 'start, settings, each settings-state check and mirror wait each read freshly');
  assert.equal(f.counts.spawn, 0); assert.equal(f.counts.write, 0);
});

test('shell-only lists do not read Claude registrations', async () => {
  const f = fixture({ recordCount: 1 }); f.records[0].kind = 'shell';
  assert.equal((await f.service.list()).conversations[0].status, 'stopped');
  assert.equal(f.counts.snapshots, 0); assert.equal(f.counts.readdir, 0);
});

test('a registrations root resolving outside the user home is never scanned', async () => {
  let reads = 0;
  const occupancy = createClaudeSessionOccupancy({ userHome: '/synthetic-home', isAlive: () => true,
    fsImpl: { realpath: async file => file.endsWith('/sessions') ? '/outside/sessions' : file,
      readdir: async () => { reads++; throw new Error('outside root must not be read'); } } });
  const read = await occupancy.snapshot();
  assert.deepEqual(read([sessionId(1)]), []); assert.equal(reads, 0);
});
