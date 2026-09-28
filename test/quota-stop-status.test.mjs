import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSessionJsonl, exhaustedRateLimitReset } from '../src/task-adapter.mjs';
import { updateNativeRecentStatus } from '../src/native-recent-status.mjs';
import { normalizeRecentSentSnapshot } from '../src/native-recent-sent-conversations.mjs';

const line = (type, payload, timestamp = '2026-09-22T10:00:00.000Z') => JSON.stringify({ timestamp, type, payload });
const meta = line('session_meta', { id: '01a0c88f-b753-7ab3-847b-4c87e90fd334', cwd: '/tmp' });
const limits = (percent, resetsAt = 1790412471) => line('event_msg', { type: 'token_count', rate_limits: { primary: { used_percent: percent, window_minutes: 10080, resets_at: resetsAt }, secondary: null } });
const aborted = line('event_msg', { type: 'turn_aborted', reason: 'interrupted' });
const parse = (...lines) => parseSessionJsonl([meta, line('event_msg', { type: 'user_message', message: '继续' }), ...lines].join('\n'));

test('a turn aborted while the quota is exhausted is a quota stop; a manual stop is not', () => {
  const quota = parse(limits(99), limits(100), aborted);
  assert.equal(quota.status, 'interrupted'); assert.equal(quota.quotaResetsAt, new Date(1790412471000).toISOString());
  assert.equal(parse(limits(42), aborted).quotaResetsAt, null, 'manual stop with quota left');
  assert.equal(parse(limits(100), aborted, line('event_msg', { type: 'user_message', message: '再来' })).quotaResetsAt, null, 'a new turn clears it');
  assert.equal(parse(limits(100), line('event_msg', { type: 'task_complete' })).quotaResetsAt, null, 'completed turns are never quota stops');
});

test('the latest reset among exhausted windows is used; the reached flag also counts', () => {
  assert.equal(exhaustedRateLimitReset({ primary: { used_percent: 100, resets_at: 10 }, secondary: { used_percent: 100, resets_at: 20 } }), 20000);
  assert.equal(exhaustedRateLimitReset({ primary: { used_percent: 100, resets_at: 10 }, secondary: { used_percent: 50, resets_at: 99 } }), 10000);
  assert.equal(exhaustedRateLimitReset({ primary: { used_percent: 80, resets_at: 30 }, rate_limit_reached_type: 'primary' }), 30000);
  assert.equal(exhaustedRateLimitReset({ primary: { used_percent: 80, resets_at: 30 } }), null);
  assert.equal(exhaustedRateLimitReset(null), null);
});

test('recent rows mark a quota stop with an hourglass until the reset, then show 已中断', () => {
  const dot = () => ({ dataset: {}, attributes: {}, replaceChildren() {}, append() {}, setAttribute(name, value) { this.attributes[name] = value; } });
  const id = '01a0c88f-b753-7ab3-847b-4c87e90fd334', documentRef = { querySelector: () => null };
  const reset = '2026-09-26T08:47:51.000Z', before = Date.parse(reset) - 1000, after = Date.parse(reset) + 1000;
  const row = { statusDot: dot() };
  updateNativeRecentStatus(documentRef, row, { kind: 'local', id }, { status: 'interrupted', unread: false, quotaResetsAt: reset }, () => [], before);
  assert.equal(row.statusDot.dataset.status, 'quota'); assert.match(row.statusDot.attributes.title, /^额度已用完 · .+ 重置$/);
  const fromTab = { statusDot: dot() };
  updateNativeRecentStatus(documentRef, fromTab, { kind: 'local', id, status: 'interrupted', quotaResetsAt: reset }, null, () => [], before);
  assert.equal(fromTab.statusDot.dataset.status, 'quota', '最近发送 rows carry the reset on the record');
  const later = { statusDot: dot() };
  updateNativeRecentStatus(documentRef, later, { kind: 'local', id }, { status: 'interrupted', unread: false, quotaResetsAt: reset }, () => [], after);
  assert.equal(later.statusDot.dataset.status, 'interrupted'); assert.equal(later.statusDot.attributes.title, '已中断');
});

test('the recent-sent snapshot keeps a valid reset time and drops junk', () => {
  const item = (quotaResetsAt) => ({ kind: 'local', id: '01a0c88f-b753-7ab3-847b-4c87e90fd334', lastUserMessageAt: '2026-09-22T10:00:00.000Z', status: 'interrupted', quotaResetsAt });
  assert.equal(normalizeRecentSentSnapshot({ items: [item('2026-09-26T08:47:51Z')] }).items[0].quotaResetsAt, '2026-09-26T08:47:51.000Z');
  assert.equal(Object.hasOwn(normalizeRecentSentSnapshot({ items: [item('<script>')] }).items[0], 'quotaResetsAt'), false, 'absent unless valid');
});
