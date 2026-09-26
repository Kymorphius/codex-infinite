import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { AccountUsageReader, normalizeAccountUsage } from '../src/account-usage.mjs';
import { createAccountUsageHttpHandler } from '../src/account-usage-http.mjs';

test('account usage keeps valid windows without leaking account metadata', () => {
  const result = normalizeAccountUsage({ accountId: 'secret-account', rateLimitsByLimitId: {
    codex: { primary: { usedPercent: 21, windowDurationMins: 10080, resetsAt: 1790724682 }, secondary: null },
    other: { limitName: 'Other', primary: { usedPercent: 120, windowDurationMins: 300 }, secondary: { usedPercent: 0, windowDurationMins: 300 } },
    missing: { primary: { windowDurationMins: 300 } }
  } });
  assert.deepEqual(result.windows, [
    { limitId: 'codex', label: 'codex', kind: 'primary', usedPercent: 21, windowDurationMins: 10080, resetsAt: 1790724682 },
    { limitId: 'other', label: 'Other', kind: 'secondary', usedPercent: 0, windowDurationMins: 300, resetsAt: null }
  ]);
  assert.equal(JSON.stringify(result).includes('secret-account'), false);
  assert.deepEqual(normalizeAccountUsage({ rateLimits: null }), { windows: [] });
});

test('usage reader closes app server after a read', async () => {
  let closed = false;
  const reader = new AccountUsageReader({ clientFactory: () => ({
    initialize: async () => {}, request: async (method) => { assert.equal(method, 'account/rateLimits/read'); return { rateLimits: { primary: { usedPercent: 5 } } }; },
    close: () => { closed = true; }
  }) });
  assert.equal((await reader.read()).windows[0].usedPercent, 5);
  assert.equal(closed, true);
});

test('invalid usage percentages stay unknown and failed reads close the app server', async () => {
  for (const usedPercent of [null, true, false, '', ' ', [], {}, Infinity]) {
    assert.deepEqual(normalizeAccountUsage({ rateLimits: { primary: { usedPercent } } }), { windows: [] });
  }
  assert.equal(normalizeAccountUsage({ rateLimits: { primary: { usedPercent: 0 } } }).windows[0].usedPercent, 0);
  let closed = false;
  const reader = new AccountUsageReader({ clientFactory: () => ({ initialize: async () => {}, request: async () => { throw Error('offline'); }, close: () => { closed = true; } }) });
  await assert.rejects(reader.read(), /offline/);
  assert.equal(closed, true);
});

test('usage HTTP endpoint is read-only and returns normalized data', async (t) => {
  const handler = createAccountUsageHttpHandler({ reader: { read: async () => ({ windows: [{ usedPercent: 5 }] }) } });
  const server = http.createServer((request, response) => handler(request, response, new URL(request.url, 'http://127.0.0.1')));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  assert.deepEqual((await (await fetch(`${origin}/api/account-usage`)).json()).windows, [{ usedPercent: 5 }]);
  assert.equal((await fetch(`${origin}/api/account-usage`, { method: 'POST' })).status, 405);
});
