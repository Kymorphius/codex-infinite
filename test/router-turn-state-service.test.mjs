import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRouterTurnStateSnapshot, routerActivityUrl, RouterTurnStateService } from "../src/router-turn-state-service.mjs";

const threadId = "01a0c463-6db9-7672-92d6-62b6367c3114";
const turnId = "01a0c4aa-1111-7222-8333-123456789abc";

test("router turn-state normalization keeps only bounded privacy-safe metadata", () => {
  const snapshot = normalizeRouterTurnStateSnapshot({ recent: [{ threadId, turnId, model: "gpt-5.6-sol", status: 200, upstreamAttempts: 1, startedAt: 10, endedAt: 20, turnState: { present: true, length: 292, value: "secret" } }, { threadId: "bad", turnState: { present: true, length: 312 } }] }, 30);
  assert.deepEqual(snapshot, { available: true, observedAt: 30, entries: [{ threadId, turnId, model: "gpt-5.6-sol", status: 200, upstreamAttempts: 1, startedAt: 10, endedAt: 20, turnState: { present: true, length: 292 } }] });
  assert.doesNotMatch(JSON.stringify(snapshot), /secret/);
});

test("router activity URL is loopback-only and keeps the capability out of output data", () => {
  const secret = "s".repeat(40);
  assert.equal(routerActivityUrl("http://127.0.0.1:4202", secret), `http://127.0.0.1:4202/_codex-router/${secret}/v1/activity`);
  assert.throws(() => routerActivityUrl("https://example.com", secret), /127\.0\.0\.1/);
});

test("router turn-state service coalesces reads and degrades closed", async () => {
  let fetches = 0;
  const service = new RouterTurnStateService({ origin: "http://127.0.0.1:4202", callerSecretPath: "/secret", readFile: async () => "x".repeat(40), fetchImpl: async () => { fetches += 1; return { ok: true, async json() { return { recent: [{ threadId, turnState: { present: false } }] }; } }; }, now: () => 100 });
  const [first, second] = await Promise.all([service.snapshot(), service.snapshot()]);
  assert.equal(fetches, 1);
  assert.deepEqual(first, second);
  assert.deepEqual(first.entries[0].turnState, { present: false });

  const unavailable = new RouterTurnStateService({ origin: "http://127.0.0.1:4202", callerSecretPath: "/secret", readFile: async () => { throw new Error("missing secret"); }, now: () => 200 });
  assert.deepEqual(await unavailable.snapshot(), { available: false, observedAt: 200, entries: [] });
});
