import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { latestThreadSettingsFromJsonl, SessionSettingsIndex } from "../src/session-settings-index.mjs";

function settingsRecord(effort, serviceTier = "default") {
  return JSON.stringify({
    type: "event_msg",
    payload: {
      type: "thread_settings_applied",
      thread_settings: {
        model: "gpt-5.6-sol",
        reasoning_effort: effort,
        service_tier: serviceTier,
        approval_policy: "never",
        active_permission_profile: { id: ":danger-full-access" }
      }
    }
  });
}

test("latest settings parser keeps native service tier with the newest event", () => {
  const result = latestThreadSettingsFromJsonl([settingsRecord("max", "priority"), settingsRecord("medium")].join("\n"));
  assert.equal(result.model, "gpt-5.6-sol");
  assert.equal(result.reasoningEffort, "medium");
  assert.equal(result.serviceTier, "default");
});

test("persistent settings index ignores enormous later records and scans only appended bytes", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "session-settings-index-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const sourceFile = path.join(directory, "rollout.jsonl");
  const indexFile = path.join(directory, "runtime", "settings.json");
  await fs.writeFile(sourceFile, `${settingsRecord("max", "priority")}\n${settingsRecord("medium")}\n${"x".repeat(256 * 1024)}\n`);
  const index = new SessionSettingsIndex({ filePath: indexFile, chunkBytes: 1024, maxRecordBytes: 16 * 1024 });
  const first = await index.read(sourceFile);
  assert.equal(first.reasoningEffort, "medium");
  assert.equal(first.serviceTier, "default");

  await fs.appendFile(sourceFile, `${settingsRecord("high", "priority")}\n`);
  const second = await index.read(sourceFile);
  assert.equal(second.reasoningEffort, "high");
  assert.equal(second.serviceTier, "priority");

  const reloaded = new SessionSettingsIndex({ filePath: indexFile, chunkBytes: 1024, maxRecordBytes: 16 * 1024 });
  assert.equal((await reloaded.read(sourceFile)).reasoningEffort, "high");
});
