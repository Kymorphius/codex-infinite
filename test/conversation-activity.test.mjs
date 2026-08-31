import test from "node:test";
import assert from "node:assert/strict";
import { normalizePeerActivity, parseConversationActivity } from "../src/conversation-activity.mjs";

const peer = { id: "forest-mac", name: "MacBook Pro", location: "192.168.1.30" };

test("conversation activity exposes exact tool input and output while excluding reasoning and event internals", () => {
  const content = [
    { type: "event_msg", timestamp: "2026-08-30T01:00:00Z", payload: { type: "task_started", turn_id: "01a04445-8d03-7243-a4d3-181180bb626d", secret: "event-secret" } },
    { type: "response_item", timestamp: "2026-08-30T01:00:01Z", payload: { type: "message", id: "u1", role: "user", content: [{ type: "input_text", text: "继续开发" }] } },
    { type: "response_item", timestamp: "2026-08-30T01:00:02Z", payload: { type: "reasoning", encrypted_content: "reasoning-secret" } },
    { type: "response_item", timestamp: "2026-08-30T01:00:03Z", payload: { type: "custom_tool_call", call_id: "c1", name: "exec_command", status: "completed", input: "tool-input-secret" } },
    { type: "response_item", timestamp: "2026-08-30T01:00:04Z", payload: { type: "custom_tool_call_output", call_id: "c1", output: "tool-output-secret" } },
    { type: "response_item", timestamp: "2026-08-30T01:00:05Z", payload: { type: "message", id: "a1", role: "assistant", phase: "commentary", content: [{ type: "output_text", text: "正在处理" }] } },
    { type: "event_msg", timestamp: "2026-08-30T01:00:06Z", payload: { type: "task_complete", turn_id: "01a04445-8d03-7243-a4d3-181180bb626d", last_agent_message: "duplicate-secret" } }
  ].map(JSON.stringify).join("\n");
  const result = parseConversationActivity(content, { threadId: "thread-1" });
  assert.deepEqual(result.entries.map((entry) => entry.kind), ["status", "message", "tool", "message", "status"]);
  assert.equal(result.entries[1].text, "继续开发");
  assert.equal(result.entries[2].name, "exec_command");
  assert.equal(result.entries[2].callId, "c1");
  assert.equal(result.entries[2].input, "tool-input-secret");
  assert.equal(result.entries[2].output, "tool-output-secret");
  assert.equal(result.turnId, "01a04445-8d03-7243-a4d3-181180bb626d");
  assert.equal(result.turnState, "completed");
  const serialized = JSON.stringify(result);
  for (const visible of ["tool-input-secret", "tool-output-secret"]) assert.match(serialized, new RegExp(visible));
  for (const hidden of ["event-secret", "reasoning-secret", "duplicate-secret"]) assert.doesNotMatch(serialized, new RegExp(hidden));
});

test("conversation activity preserves whitespace, structured function arguments, and orphan results", () => {
  const content = [
    { type: "response_item", timestamp: "2026-08-30T01:00:00Z", payload: { type: "function_call", id: "f1", call_id: "fc1", name: "write_file", arguments: { path: "/tmp/a", content: "  exact\n" } } },
    { type: "response_item", timestamp: "2026-08-30T01:00:01Z", payload: { type: "function_call_output", call_id: "fc1", output: "  saved\n" } },
    { type: "response_item", timestamp: "2026-08-30T01:00:02Z", payload: { type: "custom_tool_call_output", call_id: "missing-call", output: [{ type: "input_text", text: "tail result" }] } }
  ].map(JSON.stringify).join("\n");

  const result = parseConversationActivity(content, { threadId: "thread-1" });
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries[0].input, JSON.stringify({ path: "/tmp/a", content: "  exact\n" }, null, 2));
  assert.equal(result.entries[0].output, "  saved\n");
  assert.equal(result.entries[1].name, "tool-result");
  assert.equal(result.entries[1].output, JSON.stringify([{ type: "input_text", text: "tail result" }], null, 2));
});

test("conversation activity exposes interrupted lifecycle without hidden abort details", () => {
  const content = [
    { type: "event_msg", timestamp: "2026-08-30T01:00:00Z", payload: { type: "task_started", turn_id: "01a04445-8d03-7243-a4d3-181180bb626d" } },
    { type: "event_msg", timestamp: "2026-08-30T01:00:01Z", payload: { type: "turn_aborted", turn_id: "01a04445-8d03-7243-a4d3-181180bb626d", reason: "private-reason" } }
  ].map(JSON.stringify).join("\n");
  const result = parseConversationActivity(content, { threadId: "thread-1" });
  assert.equal(result.turnState, "interrupted");
  assert.equal(result.entries.at(-1).status, "interrupted");
  assert.doesNotMatch(JSON.stringify(result), /private-reason/);
});

test("conversation activity infers an active turn when a bounded tail starts after task_started", () => {
  const turnId = "01a05515-60f6-70f3-9f38-968b5987e9f8";
  const content = [
    { type: "event_msg", timestamp: "2026-08-30T01:00:01Z", payload: { type: "item_completed", turn_id: turnId, item: { type: "Reasoning" } } },
    { type: "response_item", timestamp: "2026-08-30T01:00:02Z", payload: { type: "message", id: "a1", role: "assistant", phase: "commentary", content: [{ type: "output_text", text: "还在执行" }], internal_chat_message_metadata_passthrough: { turn_id: turnId } } },
    { type: "response_item", timestamp: "2026-08-30T01:00:03Z", payload: { type: "custom_tool_call", call_id: "c1", name: "exec", internal_chat_message_metadata_passthrough: { turn_id: turnId } } }
  ].map(JSON.stringify).join("\n");
  const result = parseConversationActivity(content, { threadId: "thread-1" });
  assert.equal(result.turnId, turnId);
  assert.equal(result.turnState, "active");
});

test("conversation activity keeps a completed tail completed after same-turn metadata", () => {
  const turnId = "01a05515-60f6-70f3-9f38-968b5987e9f8";
  const content = [
    { type: "event_msg", timestamp: "2026-08-30T01:00:00Z", payload: { type: "turn_started", turn_id: turnId } },
    { type: "event_msg", timestamp: "2026-08-30T01:00:01Z", payload: { type: "turn_complete", turn_id: turnId } },
    { type: "response_item", timestamp: "2026-08-30T01:00:02Z", payload: { type: "message", id: "a1", role: "assistant", phase: "final", content: [{ type: "output_text", text: "完成" }], internal_chat_message_metadata_passthrough: { turn_id: turnId } } }
  ].map(JSON.stringify).join("\n");
  const result = parseConversationActivity(content, { threadId: "thread-1" });
  assert.equal(result.turnId, turnId);
  assert.equal(result.turnState, "completed");
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
  const normalized = normalizePeerActivity(peer, { ...parsed, draft: { text: "未发送内容", revision: "a".repeat(64) } });
  assert.equal(normalized.device.id, "forest-mac");
  assert.equal(normalized.draft.text, "未发送内容");
  assert.throws(() => normalizePeerActivity(peer, { schemaVersion: 1, entries: [{ kind: "reasoning", text: "no" }] }), /invalid/);
  assert.throws(() => normalizePeerActivity(peer, { schemaVersion: 1, entries: [], draft: { text: "bad", revision: "short" } }), /draft is invalid/);
  assert.throws(() => normalizePeerActivity(peer, { schemaVersion: 1, entries: [], turnId: "bad", turnState: "active" }), /turn id is invalid/);
  assert.throws(() => normalizePeerActivity(peer, { schemaVersion: 1, entries: [], turnState: "waiting-forever" }), /turn state is invalid/);
  assert.throws(() => normalizePeerActivity(peer, { schemaVersion: 1, entries: [{ kind: "tool", name: "exec", callId: "bad\nid" }] }), /call id is invalid/);
  assert.throws(() => normalizePeerActivity(peer, { schemaVersion: 1, entries: [{ kind: "tool", name: "exec", input: { command: "pwd" } }] }), /input is invalid/);
});

test("peer activity carries only validated live native session settings", () => {
  const normalized = normalizePeerActivity(peer, {
    schemaVersion: 1,
    entries: [],
    model: "gpt-5.6-sol",
    reasoningEffort: "max",
    serviceTier: "priority",
    approvalPolicy: "never",
    permissionProfile: ":danger-full-access",
    accessMode: "full-access",
    contextOverrideState: "extended",
    requestedContextWindow: 1_000_000,
    modelContextWindow: 950_000
  });
  assert.deepEqual({
    model: normalized.model,
    reasoningEffort: normalized.reasoningEffort,
    serviceTier: normalized.serviceTier,
    approvalPolicy: normalized.approvalPolicy,
    permissionProfile: normalized.permissionProfile,
    accessMode: normalized.accessMode,
    contextOverrideState: normalized.contextOverrideState,
    requestedContextWindow: normalized.requestedContextWindow,
    modelContextWindow: normalized.modelContextWindow
  }, {
    model: "gpt-5.6-sol",
    reasoningEffort: "max",
    serviceTier: "priority",
    approvalPolicy: "never",
    permissionProfile: ":danger-full-access",
    accessMode: "full-access",
    contextOverrideState: "extended",
    requestedContextWindow: 1_000_000,
    modelContextWindow: 950_000
  });
  const legacy = normalizePeerActivity(peer, { schemaVersion: 1, entries: [] });
  assert.equal(legacy.accessMode, "unknown");
  assert.equal(legacy.contextOverrideState, "unknown");
  assert.throws(() => normalizePeerActivity(peer, { schemaVersion: 1, entries: [], accessMode: "root", contextOverrideState: "default" }), /access mode/);
  assert.throws(() => normalizePeerActivity(peer, { schemaVersion: 1, entries: [], accessMode: "workspace", contextOverrideState: "default", requestedContextWindow: 1_000_000 }), /context window/);
});

test("peer activity carries only validated approvals for its exact thread", () => {
  const threadId = "01a04445-8d03-7243-a4d3-181180bb626d";
  const approval = {
    token: "01a04447-8d03-7243-a4d3-181180bb626f",
    kind: "permissions",
    threadId,
    turnId: "01a04446-8d03-7243-a4d3-181180bb626e",
    itemId: "item-1",
    startedAtMs: Date.now(),
    reason: "需要写入构建目录",
    command: null,
    cwd: "/workspace",
    networkHost: null,
    permissionSummary: ["写入 /workspace/dist"],
    decisions: ["accept", "decline"]
  };
  const normalized = normalizePeerActivity(peer, { schemaVersion: 1, threadId, entries: [], approvals: [approval] });
  assert.equal(normalized.approvals[0].kind, "permissions");
  assert.equal(normalized.approvals[0].permissionSummary[0], "写入 /workspace/dist");
  assert.throws(() => normalizePeerActivity(peer, { schemaVersion: 1, threadId, entries: [], approvals: [{ ...approval, threadId: approval.turnId }] }), /another thread/);
  assert.throws(() => normalizePeerActivity(peer, { schemaVersion: 1, threadId, entries: [], approvals: [{ ...approval, decisions: ["acceptForSession"] }] }), /decisions are invalid/);
});

test("peer activity validates the owning node's editable setting catalog", () => {
  const settingsOptions = {
    models: [{
      id: "gpt-5.6-sol", displayName: "GPT-5.6 Sol", description: "Frontier", defaultReasoningEffort: "high",
      reasoningEfforts: [{ effort: "low", description: null }, { effort: "high", description: "Deep" }],
      serviceTiers: [{ id: "default", name: "Standard", description: "Default speed" }, { id: "priority", name: "Fast", description: "1.5x" }]
    }],
    accessModes: ["read-only", "workspace", "full-access"],
    contextWindow: 1_000_000
  };
  const normalized = normalizePeerActivity(peer, { schemaVersion: 1, entries: [], settingsOptions });
  assert.equal(normalized.settingsOptions.models[0].displayName, "GPT-5.6 Sol");
  assert.equal(normalized.settingsOptions.models[0].reasoningEfforts[1].effort, "high");
  assert.equal(normalized.settingsOptions.models[0].serviceTiers[1].id, "priority");
  assert.equal(normalizePeerActivity(peer, { schemaVersion: 1, entries: [] }).settingsOptions, null);
  assert.throws(() => normalizePeerActivity(peer, { schemaVersion: 1, entries: [], settingsOptions: { ...settingsOptions, accessModes: ["root"] } }), /access option/);
  assert.throws(() => normalizePeerActivity(peer, { schemaVersion: 1, entries: [], settingsOptions: { ...settingsOptions, models: [{ ...settingsOptions.models[0], defaultReasoningEffort: "ultra" }] } }), /default reasoning/);
});
