import test from 'node:test';
import assert from 'node:assert/strict';
import { TurboCoordinator } from '../src/turbo-control.mjs';
import { TurboQuotaMonitor } from '../src/turbo-quota-monitor.mjs';
import { createTurboRuntime } from '../src/turbo-runtime.mjs';

const now = Date.parse('2026-09-26T04:00:00Z');
const usage = (usedPercent) => ({ windows: [{ limitId: 'codex', kind: 'primary', usedPercent }] });
function setup({ initial = {}, read = async () => usage(90) } = {}) {
  let policy = { enabled: true, active: true, fast: false, autoDisableOnLowQuota: true, quotaRemainingThreshold: 10, ...initial };
  const writes = [], remote = [];
  const service = { snapshot: () => ({ ...policy, active: policy.enabled && policy.active }), update: async change => { writes.push(change); policy = { ...policy, ...change }; return policy; } };
  const coordinator = new TurboCoordinator({ localService: service, peerAdapters: [{ peer: { id: 'other-account' }, updateTurbo: async change => { remote.push(change); return change; } }] });
  let poll, timerCount = 0, stopped = 0, reads = 0;
  const monitor = new TurboQuotaMonitor({ coordinator, now: () => now, reader: { read: () => { reads++; return read(); } },
    setIntervalImpl(callback, interval) { assert.equal(interval, 60000); poll = callback; timerCount++; return 1; }, clearIntervalImpl() { stopped++; } });
  return { coordinator, service, monitor, writes, remote, get reads() { return reads; }, get timers() { return timerCount; }, get stopped() { return stopped; }, poll: () => poll() };
}

test('threshold check disables only local Turbo once, preserves settings and never reenables', async () => {
  const r = setup();
  await r.monitor.start();
  assert.deepEqual(r.writes, [{ enabled: false }]);
  assert.deepEqual(r.remote, []);
  assert.equal(r.service.snapshot().fast, false);
  assert.equal(r.monitor.snapshot().state, 'triggered');
  assert.equal(r.monitor.snapshot().remainingPercent, 10);
  await r.monitor.check();
  assert.equal(r.reads, 1);
  assert.equal(r.writes.length, 1);
  r.monitor.stop();
  assert.equal(r.stopped, 1);
});

test('disabled/inapplicable trigger skips reads while healthy/unknown/failing reads preserve Turbo', async () => {
  for (const initial of [{ enabled: false }, { active: false }, { autoDisableOnLowQuota: false }]) {
    const r = setup({ initial }); await r.monitor.start(); assert.equal(r.reads, 0); assert.equal(r.writes.length, 0); r.monitor.stop();
  }
  for (const [read, state] of [[async () => usage(89), 'healthy'], [async () => ({ windows: [] }), 'unknown'], [async () => { throw Error('offline'); }, 'unknown']]) {
    const r = setup({ read }); await r.monitor.start(); assert.equal(r.monitor.snapshot().state, state); assert.equal(r.writes.length, 0); r.monitor.stop();
  }
});

test('editing the trigger after auto-off clears the outdated shutdown explanation', async () => {
  const r = setup();
  await r.monitor.start();
  assert.equal(r.monitor.snapshot().state, 'triggered');
  await r.coordinator.save({ quotaRemainingThreshold: 5 });
  assert.equal(r.monitor.snapshot().state, 'inactive');
  assert.equal(r.monitor.snapshot().thresholdPercent, 5);
  r.monitor.stop();
});

test('polls are single-flight and stop invalidates pending quota results', async () => {
  let resolve;
  const r = setup({ read: () => new Promise(done => { resolve = done; }) });
  const pending = r.monitor.start();
  r.monitor.start(); r.poll(); r.monitor.check();
  assert.equal(r.timers, 1); assert.equal(r.reads, 1);
  r.monitor.stop(); resolve(usage(100)); await pending;
  assert.deepEqual(r.writes, []);
});

test('user settings changed during quota read invalidate the pending auto-off decision', async () => {
  let resolve;
  const r = setup({ read: () => new Promise(done => { resolve = done; }) });
  const pending = r.monitor.start();
  await r.coordinator.save({ quotaRemainingThreshold: 5 });
  resolve(usage(95)); await pending;
  assert.equal(r.service.snapshot().enabled, true);
  assert.deepEqual(r.writes, [{ quotaRemainingThreshold: 5 }]);
  assert.equal(r.monitor.snapshot().state, 'unknown');
  r.monitor.stop();
});

test('mutation boundary rejects old samples and respects stop while waiting in the coordinator queue', async () => {
  const r = setup();
  const sample = { observedAt: now - 120001, expectedRevision: 0, now: () => now };
  assert.equal((await r.coordinator.disableForQuota(usage(100), sample)).state, 'superseded');
  assert.equal((await r.coordinator.disableForQuota(usage(100), { ...sample, observedAt: now, isCurrent: () => false })).state, 'superseded');
  assert.deepEqual(r.writes, []);
});

test('runtime provides safe quota state to both API and native policy snapshots', async () => {
  const r = setup();
  const runtime = createTurboRuntime({ config: { nodeDevice: { id: 'local' } }, localService: r.service, reader: { read: async () => usage(45) } });
  await runtime.start();
  assert.equal(runtime.coordinator.read().quotaStatus.remainingPercent, 55);
  assert.equal(runtime.policyProvider.snapshot().quotaStatus.state, 'healthy');
  runtime.stop();
});
