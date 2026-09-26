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

test("Turbo can always switch off without looking up or revalidating the selected model", async () => {
  let policy = { enabled: true, model: 'retired-model', reasoningEffort: 'ultra', fast: false, autoDisableOnLowQuota: true, quotaRemainingThreshold: 10, deviceIds: [] };
  const before = { ...policy };
  const service = new TurboPolicyService({ store: { snapshot: () => policy, async set(value) { policy = value; return policy; } },
    modelCatalog: { async listOptions() { assert.fail('disabling must not depend on model discovery'); } } });
  await service.update({ enabled: false });
  for (const [key, value] of Object.entries(before)) assert.deepEqual(policy[key], key === 'enabled' ? false : value);
});

test("Turbo persists its switch and bounded model maximum map", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "turbo-policy-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "turbo.json");
  const store = new TurboPolicyStore({ filePath, now: () => new Date("2026-08-31T12:00:00Z") });
  await store.init();
  const service = new TurboPolicyService({
    store,
    nodeId: "mac-air",
    devices: [{ id: "mac-air", name: "DevBook Air" }, { id: "forest-mac", name: "MacBook Pro" }],
    modelCatalog: { async listOptions() { return [{ id: "gpt-5.6-luna", reasoningEfforts: [{ effort: "high" }, { effort: "max" }] }]; } }
  });
  const enabled = await service.setEnabled(true);
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.millionContext, false);
  assert.equal(enabled.autoDisableGlobalRouting, false);
  assert.equal(enabled.autoDisableOnLowQuota, true);
  assert.equal(enabled.quotaRemainingThreshold, 10);
  assert.deepEqual(enabled.modelEfforts, [{ model: "gpt-5.6-luna", effort: "max" }]);
  const configured = await service.update({ millionContext: true });
  assert.equal(configured.enabled, true);
  assert.equal(configured.millionContext, true);
  await service.update({ model: "gpt-5.6-luna", reasoningEffort: "high", fast: false, autoDisableGlobalRouting: true, autoDisableOnLowQuota: false, quotaRemainingThreshold: 25, accessMode: "workspace", deviceIds: ["forest-mac"] });
  assert.equal(service.snapshot().active, false);
  assert.equal(service.snapshot().model, "gpt-5.6-luna");
  assert.equal(service.snapshot().reasoningEffort, "high");
  assert.equal(service.snapshot().fast, false);
  assert.equal(service.snapshot().autoDisableGlobalRouting, true);
  assert.equal(service.snapshot().accessMode, "workspace");
  assert.deepEqual(service.snapshot().deviceIds, ["forest-mac"]);
  assert.deepEqual(service.snapshot().devices.map((item) => item.id), ["mac-air", "forest-mac"]);
  const restored = new TurboPolicyStore({ filePath });
  await restored.init();
  assert.equal(restored.snapshot().enabled, true);
  assert.equal(restored.snapshot().millionContext, true);
  assert.equal(restored.snapshot().model, "gpt-5.6-luna");
  assert.equal(restored.snapshot().autoDisableGlobalRouting, true);
  assert.equal(restored.snapshot().autoDisableOnLowQuota, false);
  assert.equal(restored.snapshot().quotaRemainingThreshold, 25);
  const disabled = await new TurboPolicyService({ store: restored, modelCatalog: { async listOptions() { return []; } } }).setEnabled(false);
  assert.equal(disabled.enabled, false);
});

test("Turbo validates remaining-quota settings before writing and preserves them through catalog refresh", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "turbo-policy-quota-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "turbo.json");
  await fs.writeFile(filePath, JSON.stringify({ enabled: true, fast: false }));
  const store = new TurboPolicyStore({ filePath });
  await store.init();
  const service = new TurboPolicyService({ store });
  assert.equal(service.snapshot().autoDisableOnLowQuota, true);
  assert.equal(service.snapshot().quotaRemainingThreshold, 10);
  for (const threshold of [0, 100]) {
    await service.update({ autoDisableOnLowQuota: false, quotaRemainingThreshold: threshold });
    await service.refreshCatalog();
    const restored = new TurboPolicyStore({ filePath });
    await restored.init();
    assert.equal(restored.snapshot().autoDisableOnLowQuota, false);
    assert.equal(restored.snapshot().quotaRemainingThreshold, threshold);
    assert.equal(restored.snapshot().enabled, true);
    assert.equal(restored.snapshot().fast, false);
  }
  const before = await fs.readFile(filePath, "utf8");
  for (const change of [{ autoDisableOnLowQuota: "true" }, ...[-1, 101, 10.5, "10", null].map(quotaRemainingThreshold => ({ quotaRemainingThreshold }))]) {
    await assert.rejects(service.update(change));
    assert.equal(await fs.readFile(filePath, "utf8"), before);
  }
});
