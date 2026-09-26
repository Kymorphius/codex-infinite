import test from "node:test";
import assert from "node:assert/strict";
import {
  NativeDashboardLaunchService,
  nativeDashboardLaunchPlan,
  normalizeNativeDashboardRequest
} from "../src/native-dashboard-launch.mjs";

test("native dashboard requests accept only known modules", () => {
  assert.deepEqual(normalizeNativeDashboardRequest('{"module":"console"}'), { module: "console" });
  assert.equal(normalizeNativeDashboardRequest('{"module":"https://example.com"}'), null);
  assert.equal(normalizeNativeDashboardRequest("not-json"), null);
});

test("macOS dashboard launcher raises the installed standalone app", async () => {
  const calls = [];
  const service = new NativeDashboardLaunchService({
    platform: "darwin",
    spawn(...args) {
      calls.push(args);
      return { once(event, handler) { if (event === "spawn") handler(); }, unref() { calls.push("unref"); } };
    }
  });

  assert.deepEqual(nativeDashboardLaunchPlan("darwin"), {
    executable: "/usr/bin/open",
    args: ["-b", "dev.codex-control-console.launcher"],
    options: { detached: true, stdio: "ignore" }
  });
  assert.deepEqual(await service.open('{"module":"board"}'), { opened: true, module: "board" });
  assert.deepEqual(calls[0], ["/usr/bin/open", ["-b", "dev.codex-control-console.launcher"], { detached: true, stdio: "ignore" }]);
  assert.equal(calls[1], "unref");
  await assert.rejects(service.open('{"module":"bad"}'), /模块无效/);
});
