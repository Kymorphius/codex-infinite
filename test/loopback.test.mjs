import test from "node:test";
import assert from "node:assert/strict";
import { getConfig } from "../src/config.mjs";
import { assertLoopbackConfig, assertLoopbackHost, assertLoopbackUrl } from "../src/loopback.mjs";

test("config defaults bind both listeners to 127.0.0.1", () => {
  const config = getConfig({}, "/tmp/test-home", "linux");
  assert.equal(config.dashboardHost, "127.0.0.1");
  assert.equal(config.cdpHost, "127.0.0.1");
  assert.equal(config.dashboardPort, 47831);
  assert.equal(config.cdpPort, 9231);
  assert.equal(config.primaryCdpHost, "127.0.0.1");
  assert.equal(config.primaryCdpPort, 9232);
  assert.equal(config.primaryCdpEnabled, false);
  assert.equal(config.cspReloadRequired, true);
  assert.equal(config.jevRoutingPath, "/tmp/test-home/.codex-control-console/codex-router/jev-task-routing.json");
  assert.equal(config.routerStateDirectory, "/tmp/test-home/.codex-control-console/codex-router");
  assert.equal(config.jevThreadRoutingPath, "/tmp/test-home/.codex-control-console/codex-router/jev-native-thread-routing.json");
  assert.equal(config.jevRoutingReceiptsDirectory, "/tmp/test-home/.codex-control-console/codex-router/jev-routing-receipts");
  assert.equal(config.routerCallerSecretPath, "/tmp/test-home/.codex-control-console/codex-router/caller-secret");
  assertLoopbackConfig(config);
});

test("Jev routing follows the router state directory override", () => {
  const config = getConfig({ CODEX_ROUTER_STATE_DIR: "/tmp/shared-router-state" }, "/tmp/test-home", "linux");
  assert.equal(config.jevRoutingPath, "/tmp/shared-router-state/jev-task-routing.json");
  assert.equal(config.routerStateDirectory, "/tmp/shared-router-state");
  assert.equal(config.jevThreadRoutingPath, "/tmp/shared-router-state/jev-native-thread-routing.json");
  assert.equal(config.jevRoutingReceiptsDirectory, "/tmp/shared-router-state/jev-routing-receipts");
  assert.equal(config.routerCallerSecretPath, "/tmp/shared-router-state/caller-secret");
});

test("Windows config isolates wrapper and primary package profiles", () => {
  const config = getConfig({ LOCALAPPDATA: "C:\\Users\\Admin\\AppData\\Local" }, "C:\\Users\\Admin", "win32");
  assert.equal(config.appPath, "");
  assert.equal(config.cspReloadRequired, true);
  assert.equal(config.nativeCodexHome, "C:\\Users\\Admin\\.codex");
  assert.notEqual(config.nativeCodexHome, config.wrapperCodexHome);
  assert.equal(config.codexPath, "C:\\Users\\Admin\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe");
  assert.equal(config.profileDirectory, "C:\\Users\\Admin\\AppData\\Local\\Codex Control Console\\Profile");
  assert.match(config.primaryProfileDirectory, /OpenAI\.Codex_2p2nqsd0c76g0/);
  assert.notEqual(config.profileDirectory, config.primaryProfileDirectory);
  assert.equal(config.localManagerDeviceDirectoryPath, "C:\\LocalManagerData\\state\\manager\\device-directory.json");
  assertLoopbackConfig(config);
});

test("LocalManager device directory uses platform defaults and allows an explicit disable", () => {
  assert.equal(getConfig({}, "/Users/test", "darwin").localManagerDeviceDirectoryPath, "/Applications/local-manager/var/state/manager/device-directory.json");
  assert.equal(getConfig({}, "/tmp/test-home", "linux").localManagerDeviceDirectoryPath, "");
  assert.equal(getConfig({ CODEX_CONTROL_LOCALMANAGER_DEVICE_DIRECTORY: "" }, "/Users/test", "darwin").localManagerDeviceDirectoryPath, "");
  assert.equal(getConfig({ CODEX_CONTROL_LOCALMANAGER_DEVICE_DIRECTORY: "/private/device-directory.json" }, "/Users/test", "darwin").localManagerDeviceDirectoryPath, "/private/device-directory.json");
});

test("loopback validation rejects wildcard and LAN hosts", () => {
  assert.throws(() => assertLoopbackHost("0.0.0.0"), /exactly 127\.0\.0\.1/);
  assert.throws(() => assertLoopbackUrl("http://localhost:47831"), /127\.0\.0\.1/);
  assert.throws(() => assertLoopbackUrl("http://192.168.1.2:47831"), /127\.0\.0\.1/);
});
