import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeConversationAdapter } from '../src/native-conversation-adapter.mjs';
import { NativeThreadStatusProvider, nativeThreadStatusExpression } from '../src/native-thread-status.mjs';
import { CodexTaskAdapter } from '../src/task-adapter.mjs';
import { AttentionConversationService } from '../src/attention-conversation-service.mjs';

const id = '01a05852-9f3a-77b2-8ad3-74aa8e49c7c3';
const rows = type => [{ id, status: { type } }];
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function fixture() {
  const gate = deferred(), entered = deferred();
  const calls = { discover: 0, connect: 0, evaluate: 0, close: 0 };
  let value = rows('active'), failure = null, connectionFailure = null;
  const adapter = new NativeConversationAdapter({ cdpOrigin: 'http://fake.invalid',
    discover: async () => { calls.discover++; return [{ webSocketDebuggerUrl: 'ws://fake.invalid' }]; },
    choose: targets => targets[0], connectionFactory: () => ({
      async connect() { calls.connect++; if (connectionFailure) throw connectionFailure; },
      async evaluate(source) {
        assert.equal(source, nativeThreadStatusExpression);
        calls.evaluate++; entered.resolve(); await gate.promise;
        if (failure) throw failure;
        return value;
      }, async close() { calls.close++; }
    }) });
  return { adapter, calls, entered: entered.promise, release: gate.resolve,
    value: next => { value = next; }, fail: next => { failure = next; }, failConnection: next => { connectionFailure = next; } };
}

test('overlapping strict and permissive reads share one raw connection and return independent Maps', async () => {
  const f = fixture();
  const pending = Promise.all([f.adapter.readThreadStatuses({ strict: true }), f.adapter.readThreadStatuses(),
    f.adapter.readThreadStatuses({ strict: true })]);
  await f.entered; f.release();
  const values = await pending;
  assert.deepEqual(f.calls, { discover: 1, connect: 1, evaluate: 1, close: 1 });
  assert.ok(values.every(value => value.get(id) === 'active'));
  values[0].set(id, 'changed'); values[0].set('another', 'error'); values[1].clear();
  assert.deepEqual([...values[2]], [[id, 'active']]);
});

for (const value of [undefined, null, { data: [] }]) test(`invalid raw result ${String(value)} keeps per-caller failure policy`, async () => {
  const f = fixture(); f.value(value);
  const pending = Promise.allSettled([f.adapter.readThreadStatuses(), f.adapter.readThreadStatuses({ strict: true })]);
  await f.entered; f.release();
  const [permissive, strict] = await pending;
  assert.equal(permissive.status, 'fulfilled'); assert.equal(permissive.value.size, 0);
  assert.equal(strict.status, 'rejected'); assert.match(strict.reason.message, /unavailable/);
  assert.equal(f.calls.evaluate, 1); assert.equal(f.calls.close, 1);
  f.value(rows('idle'));
  assert.equal((await f.adapter.readThreadStatuses({ strict: true })).get(id), 'completed');
  assert.equal(f.calls.evaluate, 2);
});

test('valid arrays retain existing normalization rules independently for both callers', async () => {
  const f = fixture(); f.value([{ id: 'invalid', status: { type: 'active' } }, ...rows('systemError'),
    { id, status: { type: 'unknown' } }]);
  const pending = Promise.all([f.adapter.readThreadStatuses({ strict: true }), f.adapter.readThreadStatuses()]);
  await f.entered; f.release();
  const values = await pending;
  assert.ok(values.every(value => value.size === 1 && value.get(id) === 'error'));
  f.value([]); assert.equal((await f.adapter.readThreadStatuses({ strict: true })).size, 0);
});

test('evaluation failures clear pending, preserve strict errors and immediately recover', async () => {
  const f = fixture(), error = Error('evaluation failed'); f.fail(error);
  const pending = Promise.allSettled([f.adapter.readThreadStatuses({ strict: true }), f.adapter.readThreadStatuses()]);
  await f.entered; f.release();
  const [strict, permissive] = await pending;
  assert.equal(strict.status, 'rejected'); assert.equal(strict.reason, error);
  assert.equal(permissive.status, 'fulfilled'); assert.equal(permissive.value.size, 0);
  assert.equal(f.calls.close, 1);
  f.fail(null); f.value(rows('idle'));
  assert.equal((await f.adapter.readThreadStatuses({ strict: true })).get(id), 'completed');
  assert.equal(f.calls.evaluate, 2); assert.equal(f.calls.close, 2);
});

test('connection failures are coalesced but never cached as successful empty state', async () => {
  const f = fixture(), error = Error('connection failed'); f.failConnection(error);
  const [strict, permissive] = await Promise.allSettled([
    f.adapter.readThreadStatuses({ strict: true }), f.adapter.readThreadStatuses()
  ]);
  assert.equal(strict.status, 'rejected'); assert.equal(strict.reason, error);
  assert.equal(permissive.value.size, 0);
  assert.deepEqual(f.calls, { discover: 1, connect: 1, evaluate: 0, close: 0 });
  f.failConnection(null); f.release();
  assert.equal((await f.adapter.readThreadStatuses({ strict: true })).get(id), 'active');
  assert.equal(f.calls.connect, 2); assert.equal(f.calls.close, 1);
});

test('non-overlapping calls observe fresh changes and adapter instances remain separate', async () => {
  const a = fixture(), b = fixture(); b.value(rows('idle'));
  const pending = Promise.all([a.adapter.readThreadStatuses(), b.adapter.readThreadStatuses()]);
  await Promise.all([a.entered, b.entered]); a.release(); b.release();
  const values = await pending;
  assert.equal(values[0].get(id), 'active'); assert.equal(values[1].get(id), 'completed');
  a.value(rows('systemError'));
  assert.equal((await a.adapter.readThreadStatuses({ strict: true })).get(id), 'error');
  assert.equal(a.calls.evaluate, 2); assert.equal(b.calls.evaluate, 1);
});

test('dedicated Attention refresh shares its task-adapter and direct native status read', async () => {
  const f = fixture();
  const task = { id, cwd: '/virtual/project', project: 'project', title: 'fixture', status: 'completed', updatedAt: '2026-09-30T01:00:00.000Z' };
  const local = new CodexTaskAdapter({ sessionRoot: '/virtual/sessions',
    runtimeStatusProvider: new NativeThreadStatusProvider({ desktopBridge: f.adapter }), readTaskFileImpl: async () => task });
  local.fileScan.read = async () => [{ filePath: '/virtual/sessions/task.jsonl', stat: { dev: 1, ino: 1, ctimeMs: 1, size: 1, mtimeMs: 1 } }];
  const attention = new AttentionConversationService({ taskAdapter: local, runtimeStatusProvider: f.adapter,
    unreadStateProvider: { readUnreadIds: async () => [id] }, clock: () => 1000 });
  const pending = attention.read();
  await f.entered; await new Promise(setImmediate); f.release();
  assert.equal((await pending).stale, false);
  assert.deepEqual(f.calls, { discover: 1, connect: 1, evaluate: 1, close: 1 });
});
