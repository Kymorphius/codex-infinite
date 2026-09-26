import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTurboQuota, normalizeTurboQuotaSettings, isTurboQuotaThreshold } from '../src/turbo-quota-policy.mjs';

const now = Date.parse('2026-09-26T04:00:00Z');
const policy = { enabled: true, active: true, autoDisableOnLowQuota: true, quotaRemainingThreshold: 10 };
const usage = (usedPercent, extra = {}) => ({ windows: [{ limitId: 'codex', kind: 'primary', usedPercent, ...extra }] });

test('quota trigger defaults to enabled and 10 percent remaining with strict bounds', () => {
  assert.deepEqual(normalizeTurboQuotaSettings({}), { autoDisableOnLowQuota: true, quotaRemainingThreshold: 10 });
  for (const value of [0, 10, 100]) assert.equal(isTurboQuotaThreshold(value), true);
  for (const value of [-1, 101, 1.5, null, '10', true, NaN, Infinity]) assert.equal(isTurboQuotaThreshold(value), false);
});

test('remaining quota threshold is inclusive and checks either core window independent of duration', () => {
  for (const [used, expected] of [[89, 'healthy'], [90, 'low'], [91, 'low']]) assert.equal(evaluateTurboQuota(policy, usage(used), now).state, expected);
  assert.equal(evaluateTurboQuota({ ...policy, quotaRemainingThreshold: 0 }, usage(100), now).state, 'low');
  assert.equal(evaluateTurboQuota({ ...policy, quotaRemainingThreshold: 100 }, usage(0), now).state, 'low');
  const windows = [usage(1, { windowDurationMins: 300 }).windows[0], usage(92, { kind: 'secondary', windowDurationMins: 10080 }).windows[0]];
  assert.equal(evaluateTurboQuota(policy, { windows }, now).remainingPercent, 8);
  assert.equal(evaluateTurboQuota(policy, usage(95, { windowDurationMins: 10080 }), now).state, 'low');
});

test('unknown, invalid, expired, and non-core usage never trigger shutdown', () => {
  for (const value of [null, {}, { windows: [] }, usage(null), usage('100'), usage(true), usage(NaN), usage(101), usage(-1),
    usage(100, { limitId: 'codex_extra' }), usage(100, { resetsAt: now / 1000 }), usage(100, { resetsAt: now / 1000 - 1 })]) {
    assert.equal(evaluateTurboQuota(policy, value, now).state, 'unknown');
  }
  assert.equal(evaluateTurboQuota(policy, usage(100, { resetsAt: now / 1000 + 1 }), now).state, 'low');
  assert.equal(evaluateTurboQuota({ ...policy, autoDisableOnLowQuota: false }, usage(100), now).state, 'disabled');
  assert.equal(evaluateTurboQuota({ ...policy, enabled: false }, usage(100), now).state, 'inactive');
  assert.equal(evaluateTurboQuota({ ...policy, active: false }, usage(100), now).state, 'inactive');
});
