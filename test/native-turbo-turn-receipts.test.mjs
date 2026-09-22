import test from "node:test";
import assert from "node:assert/strict";
import { formatNativeTurboTurnReceipt, normalizeNativeTurboTurnReceipt, readNativeTurboTurnRequest } from "../src/native-turbo-turn-contract.mjs";
import { installNativeTurboTurnReceipts } from "../src/native-turbo-turn-receipts.mjs";

const threadId = "01a04445-8d03-7243-a4d3-181180bb626d";
const otherId = "01a04445-8d03-7243-a4d3-181180bb626e";
const turnId = "01a04445-8d03-7243-a4d3-181180bb626f";
const settings = { model: "gpt-6-astra", effort: "ultra", serviceTier: "priority", contextWindow: 1000000 };
const receipt = { ...settings, threadId, turnId, source: "native-settings", recordedAt: 10 };

function runtime(initial = []) {
  const listeners = new Map(), values = new Map([["codex-control-console.turbo-turn-receipts.v1", JSON.stringify(initial)]]);
  const verified = new Map([[threadId, { ...settings }]]);
  let changed = 0, time = 100;
  const hostWindow = {
    addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener); },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); }
  };
  const api = installNativeTurboTurnReceipts({ hostWindow, storage: { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) }, normalizeReceipt: normalizeNativeTurboTurnReceipt, readVerifiedSettings: (id) => verified.get(id), onChange: () => changed++, now: () => time });
  const fire = (type, event) => { for (const listener of listeners.get(type) || []) listener(event); };
  const message = (data) => fire("message", { data });
  const notify = (method, params, extra = {}) => message({ type: "mcp-notification", hostId: "local", method, params, ...extra });
  const start = (id = turnId, thread = threadId, extra) => notify("turn/started", { threadId: thread, turn: { id } }, extra);
  const response = (id, result = { turn: { id: turnId } }, extra = {}) => message({ type: "mcp-response", hostId: "local", message: { id, result }, ...extra });
  return { api, values, verified, listeners, message, notify, start, response, fire, changed: () => changed, advance: (ms) => time += ms };
}

test("Turbo receipt contract keeps bounded metadata only and formats the compact label", () => {
  assert.deepEqual(normalizeNativeTurboTurnReceipt({ ...receipt, prompt: "private", input: ["private"] }), receipt);
  assert.equal(formatNativeTurboTurnReceipt(receipt), "Turbo · GPT-6 Astra · Ultra · Fast · 百万");
  assert.equal(formatNativeTurboTurnReceipt({ ...receipt, serviceTier: null, contextWindow: null }), "Turbo · GPT-6 Astra · Ultra");
  for (const change of [{ threadId: "bad" }, { turnId: "bad" }, { model: "a".repeat(121) }, { model: "<script>" }, { effort: "maximum" }, { source: "current-policy" }, { recordedAt: NaN }]) assert.equal(normalizeNativeTurboTurnReceipt({ ...receipt, ...change }), null);
  assert.equal(normalizeNativeTurboTurnReceipt({ ...receipt, contextWindow: -1, serviceTier: "unknown" }).contextWindow, null);
});

test("dispatch snapshot obeys collaboration precedence and never guesses missing settings", () => {
  const message = { type: "mcp-request", hostId: "local", request: { method: "turn/start", params: { threadId, model: "gpt-5.6-sol", effort: "medium", serviceTierForTurn: "priority", collaborationMode: { settings: { model: "gpt-6-astra", reasoning_effort: "ultra" } } } } };
  assert.deepEqual(readNativeTurboTurnRequest(message, 1000000), { ...settings, threadId, source: "turn-start-request" });
  assert.equal(readNativeTurboTurnRequest({ ...message, hostId: "remote" }, 1000000), null);
  const missing = readNativeTurboTurnRequest({ ...message, request: { method: "turn/start", params: { threadId } } }, null);
  assert.equal(normalizeNativeTurboTurnReceipt({ ...missing, turnId, recordedAt: 0 }), null);
});

test("frozen bridge flat notifications freeze exact per-thread settings across policy changes", () => {
  const r = runtime();
  r.start(turnId, otherId);
  r.start(turnId, threadId, { hostId: "remote" });
  assert.equal(r.api.getReceipts().length, 0);
  r.start();
  r.verified.set(threadId, { ...settings, model: "gpt-5.6-luna", effort: "low" });
  r.start();
  assert.equal(r.api.getReceipts()[0].model, "gpt-6-astra");
  assert.equal(r.changed(), 1);
  r.start(otherId);
  assert.equal(r.api.getReceipts()[1].model, "gpt-5.6-luna");
  r.verified.clear();
  r.start(threadId);
  assert.equal(r.api.getReceipts().length, 2);
});

test("legacy notification envelope works and later verification never backfills an observed turn", () => {
  const r = runtime();
  r.verified.clear(); r.start();
  r.verified.set(threadId, { ...settings }); r.start();
  assert.equal(r.api.getReceipts().length, 0);
  r.message({ type: "mcp-notification", hostId: "local", request: { method: "turn/started", params: { threadId, turn: { id: otherId } } } });
  assert.equal(r.api.getReceipts()[0].turnId, otherId);
});

test("conflicting native settings invalidate the verified snapshot until a fresh verification", () => {
  for (const change of [{ model: "gpt-5.6-luna" }, { effort: "medium" }, { serviceTier: "default" }, { collaborationMode: { settings: { model: "gpt-5.6-luna", reasoning_effort: "low" } } }]) {
    const r = runtime();
    r.notify("thread/settings/updated", { threadId, threadSettings: change });
    r.start();
    assert.equal(r.api.getReceipts().length, 0);
    r.verified.set(threadId, { ...settings });
    r.start(otherId);
    assert.equal(r.api.getReceipts().length, 1);
  }
  const r = runtime();
  r.notify("thread/settings/updated", { threadId, threadSettings: { model: settings.model, effort: settings.effort, serviceTier: "priority" } });
  r.start(); assert.equal(r.api.getReceipts().length, 1);
});

test("a complete native settings confirmation passively recovers invalidation for future turns only", () => {
  const r = runtime();
  r.notify("thread/settings/updated", { threadId, threadSettings: { model: "gpt-5.6-luna" } });
  r.start();
  r.notify("thread/settings/updated", { threadId, threadSettings: { model: settings.model } });
  r.start(otherId);
  assert.equal(r.api.getReceipts().length, 0);
  r.notify("thread/settings/updated", { threadId, threadSettings: { model: settings.model, effort: settings.effort, serviceTier: settings.serviceTier } });
  r.start(); r.start(otherId);
  assert.equal(r.api.getReceipts().length, 0);
  r.start(threadId);
  assert.equal(r.api.getReceipts().length, 1);
});

test("dispatch receipts correlate only successful responses, retain snapshot and tolerate response order", () => {
  const r = runtime();
  const sent = { ...settings, threadId, source: "turn-start-request" };
  r.api.trackRequest("a", sent);
  sent.model = "gpt-5.6-luna";
  r.api.trackRequest("b", { ...sent, threadId: otherId });
  r.response("wrong"); r.response("a", { turn: { id: turnId } }, { hostId: "remote" });
  assert.equal(r.api.getReceipts().length, 0);
  r.response("b", { turn: { id: otherId } }); r.response("a");
  assert.deepEqual(r.api.getReceipts().map((entry) => [entry.threadId, entry.turnId, entry.model]), [[otherId, otherId, "gpt-5.6-luna"], [threadId, turnId, "gpt-6-astra"]]);
  r.response("a"); assert.equal(r.api.getReceipts().length, 2);
});

test("failed, cancelled, expired, cross-thread or malformed responses never annotate", () => {
  const r = runtime(), snapshot = { ...settings, threadId, source: "turn-start-request" };
  r.api.trackRequest("error", snapshot);
  r.message({ type: "mcp-response", hostId: "local", message: { id: "error", error: { message: "failed" }, result: { turn: { id: turnId } } } });
  r.api.trackRequest("cancel", snapshot)(); r.response("cancel");
  r.api.trackRequest("expired", snapshot); r.advance(300001); r.response("expired");
  r.api.trackRequest("thread", snapshot); r.response("thread", { threadId: otherId, turn: { id: turnId } });
  r.api.trackRequest("bad", snapshot); r.response("bad", { turn: { id: "bad" } });
  r.api.trackRequest("method", snapshot); r.response("method", { turn: { id: turnId } }, { requestMethod: "thread/resume" });
  assert.equal(r.api.getReceipts().length, 0);
});

test("history is bounded, privacy-safe, immutable and merged across profile windows", () => {
  const id = (i) => "01a04445-8d03-7243-a4d3-" + String(i).padStart(12, "0");
  const r = runtime(Array.from({ length: 520 }, (_, i) => ({ ...receipt, turnId: id(i), recordedAt: i, prompt: "private" })));
  assert.equal(r.api.getReceipts().length, 512);
  r.values.set("codex-control-console.turbo-turn-receipts.v1", JSON.stringify([{ ...receipt, turnId: otherId, recordedAt: 1000 }]));
  r.advance(2000); r.start();
  const stored = JSON.parse(r.values.get("codex-control-console.turbo-turn-receipts.v1"));
  assert.equal(stored.length, 512);
  assert(stored.some((entry) => entry.turnId === otherId));
  assert(stored.every((entry) => !Object.hasOwn(entry, "prompt")));
  r.fire("storage", { key: "codex-control-console.turbo-turn-receipts.v1", newValue: JSON.stringify([{ ...receipt, model: "gpt-5.6-luna" }]) });
  assert.equal(r.api.getReceipts().find((entry) => entry.turnId === turnId).model, "gpt-6-astra");
  r.api.cleanup();
  assert.equal(r.listeners.get("message").size, 0); assert.equal(r.listeners.get("storage").size, 0);
});
