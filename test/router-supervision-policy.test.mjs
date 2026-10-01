import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveRouterStatus, shouldAutoRepair, AUTO_REPAIR_POLICY } from '../src/router-supervision-policy.mjs';

const service = (overrides = {}) => ({ supported: true, installed: true, enabled: true, loaded: true, ...overrides });
const health = (overrides = {}) => ({ reachable: true, ok: true, degraded: [], ...overrides });

test('router status separates intentional off states from repairable failures', () => {
  assert.deepEqual(deriveRouterStatus({ service: { supported: false } }), { status: 'unknown', reason: '当前系统不支持 Router 服务检查', repair: null });
  assert.equal(deriveRouterStatus({ service: service({ installed: false }) }).status, 'not-installed');
  assert.equal(deriveRouterStatus({ service: service({ installed: false }) }).repair, null);
  assert.equal(deriveRouterStatus({ service: service({ enabled: false, loaded: false }) }).status, 'disabled');
  assert.equal(deriveRouterStatus({ service: service({ enabled: false, loaded: false }) }).repair, null);
  assert.deepEqual(deriveRouterStatus({ service: service({ loaded: false }) }), { status: 'stopped', reason: 'Router 服务未加载到 launchd', repair: 'bootstrap' });
});

test('loaded router health decides between ready, partial degradation and manual restart', () => {
  assert.equal(deriveRouterStatus({ service: service(), health: health() }).status, 'ready');
  assert.equal(deriveRouterStatus({ service: service(), health: { reachable: false } }).repair, 'kickstart');
  assert.equal(deriveRouterStatus({ service: service(), health: health({ ok: false }) }).repair, 'kickstart');
  const partial = deriveRouterStatus({ service: service(), health: health({ degraded: ['gateway'] }) });
  assert.equal(partial.status, 'degraded'); assert.equal(partial.repair, null); assert.match(partial.reason, /gateway/);
});

test('auto repair needs consecutive stopped observations and is throttled', () => {
  const now = 10 * 60 * 60_000;
  assert.equal(shouldAutoRepair({ status: 'stopped', stoppedStreak: 1, now }), false);
  assert.equal(shouldAutoRepair({ status: 'stopped', stoppedStreak: 2, now }), true);
  assert.equal(shouldAutoRepair({ status: 'degraded', stoppedStreak: 5, now }), false);
  assert.equal(shouldAutoRepair({ status: 'stopped', stoppedStreak: 2, now, history: [{ at: now - 60_000, trigger: 'auto' }] }), false);
  assert.equal(shouldAutoRepair({ status: 'stopped', stoppedStreak: 2, now, history: [{ at: now - 60_000, trigger: 'manual' }] }), true);
  const spaced = Array.from({ length: AUTO_REPAIR_POLICY.maxPerWindow }, (_, index) => ({ at: now - (index + 1) * 10 * 60_000, trigger: 'auto' }));
  assert.equal(shouldAutoRepair({ status: 'stopped', stoppedStreak: 2, now, history: spaced }), false);
  assert.equal(shouldAutoRepair({ status: 'stopped', stoppedStreak: 2, now, history: spaced.slice(1) }), true);
});
