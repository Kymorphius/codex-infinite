import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { highestModelEfforts, TurboPolicyService, TurboPolicyStore } from "../src/turbo-policy.mjs";

test("Turbo selects the highest supported effort per model rather than one universal value", () => {
  assert.deepEqual(highestModelEfforts([
    { id: "sol", reasoningEfforts: [{ effort: "medium" }, { effort: "ultra" }, { effort: "max" }] },
    { id: "luna", reasoningEfforts: [{ effort: "low" }, { effort: "max" }] }
  ]), [{ model: "sol", effort: "ultra" }, { model: "luna", effort: "max" }]);
});

test("Turbo persists its switch and bounded model maximum map", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "turbo-policy-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "turbo.json");
  const store = new TurboPolicyStore({ filePath, now: () => new Date("2026-08-31T12:00:00Z") });
  await store.init();
  const service = new TurboPolicyService({
    store,
    nodeId: "matrix-air",
    devices: [{ id: "matrix-air", name: "MatrixBook Air" }, { id: "forest-mac", name: "MacBook Pro" }],
    modelCatalog: { async listOptions() { return [{ id: "gpt-5.6-luna", reasoningEfforts: [{ effort: "high" }, { effort: "max" }] }]; } }
  });
  const enabled = await service.setEnabled(true);
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.millionContext, false);
  assert.deepEqual(enabled.modelEfforts, [{ model: "gpt-5.6-luna", effort: "max" }]);
  const configured = await service.update({ millionContext: true });
  assert.equal(configured.enabled, true);
  assert.equal(configured.millionContext, true);
  await service.update({ model: "gpt-5.6-luna", reasoningEffort: "high", fast: false, accessMode: "workspace", deviceIds: ["forest-mac"] });
  assert.equal(service.snapshot().active, false);
  assert.equal(service.snapshot().model, "gpt-5.6-luna");
  assert.equal(service.snapshot().reasoningEffort, "high");
  assert.equal(service.snapshot().fast, false);
  assert.equal(service.snapshot().accessMode, "workspace");
  assert.deepEqual(service.snapshot().deviceIds, ["forest-mac"]);
  assert.deepEqual(service.snapshot().devices.map((item) => item.id), ["matrix-air", "forest-mac"]);
  const restored = new TurboPolicyStore({ filePath });
  await restored.init();
  assert.equal(restored.snapshot().enabled, true);
  assert.equal(restored.snapshot().millionContext, true);
  assert.equal(restored.snapshot().model, "gpt-5.6-luna");
  const disabled = await new TurboPolicyService({ store: restored, modelCatalog: { async listOptions() { return []; } } }).setEnabled(false);
  assert.equal(disabled.enabled, false);
});
