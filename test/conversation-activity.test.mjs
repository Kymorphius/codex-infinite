import test from "node:test";
import assert from "node:assert/strict";
import { normalizePeerActivity, parseConversationActivity } from "../src/conversation-activity.mjs";

const peer = { id: "forest-mac", name: "森林 Mac", location: "森林" };

test("conversation activity allowlists visible messages and lifecycle without tool payloads or reasoning", () => {
  const content = [
    { type: "event_msg", timestamp: "2026-08-30T01:00:00Z", payload: { type: "task_started", secret: "event-secret" } },
    { type: "response_item", timestamp: "2026-08-30T01:00:01Z", payload: { type: "message", id: "u1", role: "user", content: [{ type: "input_text", text: "继续开发" }] } },
    { type: "response_item", timestamp: "2026-08-30T01:00:02Z", payload: { type: "reasoning", encrypted_content: "reasoning-secret" } },
    { type: "response_item", timestamp: "2026-08-30T01:00:03Z", payload: { type: "custom_tool_call", call_id: "c1", name: "exec_command", status: "completed", input: "tool-input-secret" } },
    { type: "response_item", timestamp: "2026-08-30T01:00:04Z", payload: { type: "custom_tool_call_output", call_id: "c1", output: "tool-output-secret" } },
    { type: "response_item", timestamp: "2026-08-30T01:00:05Z", payload: { type: "message", id: "a1", role: "assistant", phase: "commentary", content: [{ type: "output_text", text: "正在处理" }] } },
    { type: "event_msg", timestamp: "2026-08-30T01:00:06Z", payload: { type: "task_complete", last_agent_message: "duplicate-secret" } }
  ].map(JSON.stringify).join("\n");
  const result = parseConversationActivity(content, { threadId: "thread-1" });
  assert.deepEqual(result.entries.map((entry) => entry.kind), ["status", "message", "tool", "message", "status"]);
  assert.equal(result.entries[1].text, "继续开发");
  assert.equal(result.entries[2].name, "exec_command");
  const serialized = JSON.stringify(result);
  for (const secret of ["event-secret", "reasoning-secret", "tool-input-secret", "tool-output-secret", "duplicate-secret"]) assert.doesNotMatch(serialized, new RegExp(secret));
});

test("conversation activity is bounded and remote activity fails closed on malformed entries", () => {
  const content = Array.from({ length: 70 }, (_, index) => JSON.stringify({
    type: "response_item", timestamp: `2026-08-30T01:00:${String(index % 60).padStart(2, "0")}Z`,
    payload: { type: "message", id: `m${index}`, role: "assistant", content: [{ type: "output_text", text: "x".repeat(5000) }] }
  })).join("\n");
  const parsed = parseConversationActivity(content, { threadId: "thread-1" });
  assert.ok(parsed.entries.length <= 60);
  assert.ok(parsed.entries.every((entry) => entry.text.length <= 4000));
  assert.ok(parsed.entries.reduce((sum, entry) => sum + (entry.text?.length || 0), 0) <= 64 * 1024);
  const normalized = normalizePeerActivity(peer, parsed);
  assert.equal(normalized.device.id, "forest-mac");
  assert.throws(() => normalizePeerActivity(peer, { schemaVersion: 1, entries: [{ kind: "reasoning", text: "no" }] }), /invalid/);
});
