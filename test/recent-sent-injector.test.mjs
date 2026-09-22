import test from "node:test";
import assert from "node:assert/strict";
import { CodexInjector, installIntoTarget } from "../src/injector.mjs";
import { buildNativeRecentSentSnapshotScript } from "../src/native-recent-sent-conversations.mjs";

const dashboardUrl = "http://127.0.0.1:47831";
const snapshot = {
  items: [{ kind: "local", id: "0197a222-1111-7222-8333-111111111111", title: "Recently sent", lastUserMessageAt: "2026-09-22T08:00:00.000Z" }],
  loading: false,
  stale: false
};

function fakeConnection() {
  const calls = [];
  return {
    calls,
    async send(method, params) { calls.push({ method, params }); return {}; },
    async evaluate(source) {
      calls.push({ method: "evaluate", source });
      if (source.includes("CspDocumentToken")) return "document-1";
      if (source.includes("frameRecoveryManaged")) return { hasEntry: true, hasFrame: false, frameReady: false, frameRecoveryManaged: false, frameRecoveryRequest: "" };
      return false;
    },
    async close() {}
  };
}

test("recent-sent snapshot reaches initial and already-installed renderers before tab installation", async () => {
  const connection = fakeConnection();
  const expectedSource = buildNativeRecentSentSnapshotScript(snapshot);
  const initial = await installIntoTarget(connection, dashboardUrl, { recentSentConversations: snapshot, reloadAfterCspBypass: false });
  assert.equal(initial.status, "installed");
  const preparedScriptCount = connection.calls.filter(({ method }) => method === "Page.addScriptToEvaluateOnNewDocument").length;
  assert.equal(connection.calls.filter(({ source }) => source === expectedSource).length, 1);
  assert.ok(connection.calls.findIndex(({ source }) => source === expectedSource) < connection.calls.length - 1);
  assert.equal(connection.calls.at(-1).source.includes("installNativeConversationTabs"), true);

  connection.calls.length = 0;
  const next = { ...snapshot, loading: true, stale: true };
  const repeated = await installIntoTarget(connection, dashboardUrl, { recentSentConversations: next, reloadAfterCspBypass: false });
  assert.equal(repeated.status, "already-installed");
  assert.equal(connection.calls.filter(({ source }) => source === buildNativeRecentSentSnapshotScript(next)).length, 1);
  assert.equal(connection.calls.at(-1).source.includes("installNativeConversationTabs"), true);
  assert.equal(connection.calls.some(({ method }) => method === "Page.addScriptToEvaluateOnNewDocument"), false);
  assert.equal(connection.calls.some(({ method }) => method === "Runtime.addBinding"), false);
  assert.equal(connection.calls.some(({ method }) => method === "Page.reload"), false);
  assert.ok(preparedScriptCount > 0);
});

test("existing injector sync reads recent-sent provider once without a second polling timer or task scan", async () => {
  let reads = 0;
  const warnings = [];
  const connection = fakeConnection();
  const provider = { read() { reads += 1; return snapshot; }, listTasks() { assert.fail("must consume the provider snapshot, not scan tasks"); } };
  const injector = new CodexInjector({
    cdpOrigin: "http://127.0.0.1:9231", dashboardUrl,
    recentSentConversationProvider: provider,
    reloadAfterCspBypass: false,
    logger: { warn(message) { warnings.push(message); } }
  });
  injector.targetId = "app";
  injector.connection = connection;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, async json() { return [{ type: "page", id: "app", url: "app://-/index.html", webSocketDebuggerUrl: "ws://127.0.0.1:9231/app" }]; } });
  try {
    await injector.sync();
    await injector.sync();
    assert.equal(reads, 2);
    assert.equal(connection.calls.filter(({ source }) => source === buildNativeRecentSentSnapshotScript(snapshot)).length, 2);
    assert.equal(injector.timer, null);
    assert.deepEqual(warnings, []);
  } finally {
    globalThis.fetch = originalFetch;
    await injector.stop();
  }
});

test("recent-sent provider remains optional for existing injector callers", async () => {
  const connection = fakeConnection();
  await installIntoTarget(connection, dashboardUrl, { reloadAfterCspBypass: false });
  assert.equal(connection.calls.some(({ source }) => source === buildNativeRecentSentSnapshotScript(undefined)), true);
  const injector = new CodexInjector({ cdpOrigin: "http://127.0.0.1:9231", dashboardUrl });
  assert.equal(injector.recentSentConversationProvider, null);
});
