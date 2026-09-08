import test from "node:test";
import assert from "node:assert/strict";
import { createDashboardServer } from "../src/http-server.mjs";
import { RuntimeDiagnosticsService, deriveRuntimeDiagnostics } from "../src/runtime-diagnostics.mjs";

function config() {
  return {
    dashboardHost: "127.0.0.1", dashboardPort: 0, dashboardOrigin: "http://127.0.0.1:0",
    cdpHost: "127.0.0.1", cdpPort: 9231, cdpOrigin: "http://127.0.0.1:9231", profileDirectory: "/tmp/diagnostics-test"
  };
}

test("runtime diagnostics distinguish unavailable native runtime from healthy local services", () => {
  const result = deriveRuntimeDiagnostics({
    runtime: { authority: "owner-native-desktop", health: "unavailable", submission: "unavailable" },
    dispatch: { status: "ready", queued: 2, sending: 0, deliveryUnknown: 1 },
    audit: { status: "ready", lastWriteAt: null, reason: null },
    scheduler: { status: "ready", busy: false, lastTickAt: null, lastSuccessAt: null, lastFailureAt: null }
  });
  assert.equal(result.passive, true);
  assert.equal(result.status, "unavailable");
  assert.equal(result.checks.find((check) => check.name === "native-desktop").status, "unavailable");
  assert.equal(result.checks.find((check) => check.name === "dispatch-store").details.deliveryUnknown, 1);
});

test("diagnostics HTTP is read-only and performs only passive provider reads", async (context) => {
  let runtimeReads = 0;
  const diagnosticsService = new RuntimeDiagnosticsService({
    nodeRuntimeService: { async read() { runtimeReads += 1; return { authority: "owner-native-desktop", health: "connected", submission: "native-composer" }; } },
    dispatchStore: { diagnostics() { return { status: "ready", queued: 0, sending: 0, deliveryUnknown: 0 }; } },
    auditStore: { diagnostics() { return { status: "ready", lastWriteAt: null, reason: null }; } },
    scheduler: { diagnostics() { return { status: "ready", busy: false }; } }
  });
  const dashboard = createDashboardServer({ config: config(), adapter: {}, diagnosticsService });
  await dashboard.listen();
  context.after(() => dashboard.close());
  const origin = `http://127.0.0.1:${dashboard.server.address().port}`;
  const response = await fetch(`${origin}/api/diagnostics`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "ready");
  assert.equal(runtimeReads, 1);
  assert.equal((await fetch(`${origin}/api/diagnostics`, { method: "POST" })).status, 405);
});

test("diagnostics endpoint reports an unavailable service explicitly", async (context) => {
  const dashboard = createDashboardServer({ config: config(), adapter: {} });
  await dashboard.listen();
  context.after(() => dashboard.close());
  const origin = `http://127.0.0.1:${dashboard.server.address().port}`;
  assert.equal((await fetch(`${origin}/api/diagnostics`)).status, 503);
});
