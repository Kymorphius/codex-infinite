import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ContextWindowStore, ModelCatalog, describeContextOverride, validateContextWindow } from "../src/context-window.mjs";

test("context window validation accepts one million and rejects unsafe values", () => {
  assert.equal(validateContextWindow("1,000,000"), 1_000_000);
  assert.throws(() => validateContextWindow(12_000), /32,000/);
  assert.throws(() => validateContextWindow("wide"), /整数/);
});

test("per-thread override persists without affecting other threads", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codex-context-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "context-windows.json");
  const now = () => new Date("2026-08-27T01:00:00.000Z");
  const store = new ContextWindowStore({ filePath, now });
  await store.init();
  await store.set("01a015ac-363f-7472-961a-f31d174ad2c8", 1_000_000);
  assert.equal(store.get("01a015ac-363f-7472-961a-f31d174ad2c8").requestedContextWindow, 1_000_000);
  assert.equal(store.get("01a015ac-363f-7472-961a-f31d174ad2c9"), null);

  const reloaded = new ContextWindowStore({ filePath });
  await reloaded.init();
  assert.equal(reloaded.list()[0].requestedContextWindow, 1_000_000);
});

test("model catalog reports clamped and effective context windows truthfully", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codex-model-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "models.json");
  await fs.writeFile(filePath, JSON.stringify({ models: [{ slug: "gpt-5.6-sol", context_window: 272000, max_context_window: 872000, effective_context_window_percent: 95 }] }));
  const catalog = new ModelCatalog({ filePath });
  const result = await describeContextOverride(
    { threadId: "01a015ac-363f-7472-961a-f31d174ad2c8", requestedContextWindow: 1_000_000 },
    { title: "Demo", model: "gpt-5.6-sol", modelContextWindow: 258400 },
    catalog
  );
  assert.equal(result.acceptedContextWindow, 872_000);
  assert.equal(result.estimatedEffectiveContextWindow, 828_400);
  assert.equal(result.clamped, true);
  assert.equal(result.observedContextWindow, 258_400);
});
