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

test("restart binding requires exact confirmation and never opens a dashboard", async () => {
  let count = 0;
  const service = new NativeDashboardLaunchService({ restart: () => { count++; return { restarting: true }; }, spawn: () => assert.fail("must not spawn dashboard") });
  for (const request of [{ module: 'restart' }, { module: 'restart', confirm: false }, { module: 'restart', confirm: true, url: 'other' }]) {
    await assert.rejects(service.open(JSON.stringify(request)), /模块无效/);
  }
  assert.equal(count, 0);
  assert.deepEqual(await service.open('{"module":"restart","confirm":true}'), { restarting: true });
  assert.equal(count, 1);
});

test("original launch uses the existing native app service with no caller supplied path", async () => {
  let count = 0;
  const service = new NativeDashboardLaunchService({ launchOriginal: () => { count++; return { started: true }; }, spawn: () => assert.fail("must not spawn dashboard") });
  assert.equal(normalizeNativeDashboardRequest('{"module":"original","appPath":"/tmp/other"}'), null);
  await assert.rejects(service.open('{"module":"original","appPath":"/tmp/other"}'), /模块无效/);
  assert.deepEqual(await service.open('{"module":"original"}'), { started: true });
  assert.equal(count, 1);
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

test('Windows host actions do not invoke the macOS standalone launcher', async () => {
  const calls = [];
  const service = new NativeDashboardLaunchService({ platform: 'win32',
    restart: () => calls.push('restart'), launchOriginal: () => calls.push('original'),
    spawn: () => assert.fail('Windows host actions must not spawn standalone dashboard') });
  await service.open('{"module":"original"}');
  await service.open('{"module":"restart","confirm":true}');
  assert.deepEqual(calls, ['original', 'restart']);
  await assert.rejects(service.open('{"module":"restart","confirm":false}'), /模块无效/);
});
