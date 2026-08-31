import test from "node:test";
import assert from "node:assert/strict";
import { accessModeFromProfile, normalizeThreadSettings } from "../src/thread-settings.mjs";

test("native thread settings keep only the bounded display contract", () => {
  const result = normalizeThreadSettings({
    model: "gpt-5.6-sol",
    reasoning_effort: "max",
    service_tier: "priority",
    approval_policy: "never",
    permission_profile: { type: "disabled" },
    active_permission_profile: { id: ":danger-full-access" },
    collaboration_mode: { settings: { developer_instructions: "must stay private" } }
  });
  assert.deepEqual(result, {
    model: "gpt-5.6-sol",
    reasoningEffort: "max",
    serviceTier: "priority",
    approvalPolicy: "never",
    permissionProfile: ":danger-full-access",
    accessMode: "full-access"
  });
  assert.equal(JSON.stringify(result).includes("developer"), false);
});

test("native access profiles normalize without inventing missing permission state", () => {
  assert.equal(accessModeFromProfile(":workspace"), "workspace");
  assert.equal(accessModeFromProfile("read-only"), "read-only");
  assert.equal(accessModeFromProfile("managed"), "custom");
  assert.equal(accessModeFromProfile(null), "unknown");
  assert.equal(normalizeThreadSettings({ permission_profile: { type: "disabled" } }).accessMode, "full-access");
});
