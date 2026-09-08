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
  assertLoopbackConfig(config);
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
  assertLoopbackConfig(config);
});

test("loopback validation rejects wildcard and LAN hosts", () => {
  assert.throws(() => assertLoopbackHost("0.0.0.0"), /exactly 127\.0\.0\.1/);
  assert.throws(() => assertLoopbackUrl("http://localhost:47831"), /127\.0\.0\.1/);
  assert.throws(() => assertLoopbackUrl("http://192.168.1.2:47831"), /127\.0\.0\.1/);
});
