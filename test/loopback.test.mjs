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
  assertLoopbackConfig(config);
});

test("loopback validation rejects wildcard and LAN hosts", () => {
  assert.throws(() => assertLoopbackHost("0.0.0.0"), /exactly 127\.0\.0\.1/);
  assert.throws(() => assertLoopbackUrl("http://localhost:47831"), /127\.0\.0\.1/);
  assert.throws(() => assertLoopbackUrl("http://192.168.1.2:47831"), /127\.0\.0\.1/);
});
