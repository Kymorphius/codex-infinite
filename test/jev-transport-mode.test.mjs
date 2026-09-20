import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { applyJevTransportModeToConfig, JevTransportModeManager } from "../src/jev-transport-mode.mjs";

const managed = `model = "gpt-5.6-sol"
# BEGIN codex-router-managed
openai_base_url = "http://127.0.0.1:4202/v1"

[model_providers.codex-router]
base_url = "http://127.0.0.1:4202/v1"
wire_api = "responses"
`;

test("transport mode changes only the managed root Router endpoint", () => {
  const native = applyJevTransportModeToConfig(managed, "native");
  assert.doesNotMatch(native.split("[model_providers.codex-router]")[0], /openai_base_url/);
  assert.match(native, /base_url = "http:\/\/127\.0\.0\.1:4202\/v1"/);
  assert.equal(applyJevTransportModeToConfig(native, "router"), managed);
  assert.equal(applyJevTransportModeToConfig(managed, "router"), managed);
});

test("transport mode refuses an unmanaged root endpoint", () => {
  const config = `openai_base_url = "https://example.test/v1"\n# BEGIN codex-router-managed\n[model_providers.codex-router]\nbase_url = "http://127.0.0.1:4202/v1"\n`;
  assert.throws(() => applyJevTransportModeToConfig(config, "native"), /不属于加强版 Router 管理区/);
});

test("router mode enables signed-session discovery and restarts only Router on macOS", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "jev-transport-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, "config.toml"), discoveryPath = path.join(directory, "state", "discovery-mode.json");
  await fs.writeFile(configPath, applyJevTransportModeToConfig(managed, "native"));
  const calls = [];
  const manager = new JevTransportModeManager({ configPath, discoveryPath, platform: "darwin", uid: 501, execute: async (...args) => { calls.push(args); } });
  assert.deepEqual(await manager.apply("router"), { mode: "router", runtimeRestartRequired: true, routerRestarted: true });
  assert.deepEqual(JSON.parse(await fs.readFile(discoveryPath, "utf8")), { version: 1, discovery: "enabled" });
  assert.deepEqual(calls, [["/bin/launchctl", ["kickstart", "-k", "gui/501/io.github.codex-router"]]]);
  assert.deepEqual(await manager.apply("router"), { mode: "router", runtimeRestartRequired: true, routerRestarted: true });
  assert.equal(calls.length, 1);
});
