import assert from "node:assert/strict";
import test from "node:test";
import { buildNativeTurnStateInjectionScript, buildNativeTurnStateSnapshotScript, normalizeNativeTurnStateSnapshot, summarizeNativeTurnState, summarizeNativeTurnStates } from "../src/native-turn-state-status.mjs";

const current = "01a0c463-6db9-7672-92d6-62b6367c3114";
const other = "01a0c47f-f950-79b3-80fd-bd634f05ee17";
const turnId = "01a0c4aa-1111-7222-8333-123456789abc";

test("native turn-state summaries remain conversation scoped", () => {
  const snapshot = normalizeNativeTurnStateSnapshot({ available: true, observedAt: 50, entries: [{ threadId: current, model: "gpt-5.6-sol", status: 200, turnState: { present: false } }, { threadId: other, model: "gpt-6-astra", status: 200, turnState: { present: true, length: 312 } }, { threadId: current, turnId, model: "gpt-5.6-sol", status: 200, upstreamAttempts: 1, endedAt: 40, turnState: { present: true, length: 292, value: "private" } }] });
  const summary = summarizeNativeTurnStates(snapshot, current);
  assert.equal(summary.entries.length, 2);
  assert.deepEqual(summary.counts, { none: 1, 292: 1 });
  assert.deepEqual(summary.latest.turnState, { present: true, length: 292 });
  assert.equal(summarizeNativeTurnState(snapshot, current, turnId).latest.turnId, turnId);
  assert.equal(summarizeNativeTurnState(snapshot, current, other).latest, null);
  assert.doesNotMatch(JSON.stringify(snapshot), /private/);
  assert.doesNotMatch(JSON.stringify(summary), /gpt-6-astra/);
});

test("native injection renders header and exact-turn badges with an explicit quality disclaimer", () => {
  const source = buildNativeTurnStateInjectionScript();
  assert.match(source, /data-codex-control-console-turn-state/);
  assert.match(source, /State 292|State ' \+ entry\.turnState\.length/);
  assert.match(source, /长度本身不代表模型质量/);
  assert.match(source, /data-above-composer-conversation-id/);
  assert.match(source, /data-content-search-turn-key/);
  assert.match(source, /data-codex-control-console-turn-state-turn/);
  assert.match(source, /const summarizeNativeTurnStates = summarize/);
  const snapshot = buildNativeTurnStateSnapshotScript({ available: true, entries: [{ threadId: current, turnState: { present: true, length: 292 } }] });
  assert.match(snapshot, /SetTurnStateSnapshot/);
  assert.doesNotMatch(snapshot, /x-codex-turn-state/);
});
