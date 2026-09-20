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
const callerSecret = "test-enhanced-codex-router-capability-0123456789";
const routedBase = `http://127.0.0.1:4202/_codex-router/${callerSecret}/jev/v1`;

test("transport mode changes only the managed root Router endpoint", () => {
  const native = applyJevTransportModeToConfig(managed, "native");
  assert.doesNotMatch(native.split("[model_providers.codex-router]")[0], /openai_base_url/);
  assert.match(native, /base_url = "http:\/\/127\.0\.0\.1:4202\/v1"/);
  assert.match(applyJevTransportModeToConfig(native, "router", callerSecret), new RegExp(routedBase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(applyJevTransportModeToConfig(managed, "router", callerSecret), new RegExp(routedBase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("transport mode refuses an unmanaged root endpoint", () => {
  const config = `openai_base_url = "https://example.test/v1"\n# BEGIN codex-router-managed\n[model_providers.codex-router]\nbase_url = "http://127.0.0.1:4202/v1"\n`;
  assert.throws(() => applyJevTransportModeToConfig(config, "native"), /不属于加强版 Router 管理区/);
});

test("router mode uses the private caller capability without discovery or restart side effects", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "jev-transport-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, "config.toml"), callerSecretPath = path.join(directory, "state", "caller-secret");
  await fs.writeFile(configPath, applyJevTransportModeToConfig(managed, "native"));
  await fs.mkdir(path.dirname(callerSecretPath), { recursive: true });
  await fs.writeFile(callerSecretPath, `${callerSecret}\n`, { mode: 0o600 });
  const manager = new JevTransportModeManager({ configPath, callerSecretPath });
  assert.deepEqual(await manager.apply("router"), { mode: "router", runtimeRestartRequired: true, routerRestarted: false });
  assert.match(await fs.readFile(configPath, "utf8"), new RegExp(routedBase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.deepEqual(await manager.apply("router"), { mode: "router", runtimeRestartRequired: true, routerRestarted: false });
});
