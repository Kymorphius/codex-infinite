import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CodexTaskAdapter, normalizeSessionDevice, parseSessionJsonl } from "../src/task-adapter.mjs";
import { resolveDispatchTarget } from "../src/dispatch-http.mjs";
import { SessionSettingsIndex } from "../src/session-settings-index.mjs";

test("session adapter extracts truthful task metadata without requiring app internals", () => {
  const content = [
    JSON.stringify({ type: "session_meta", timestamp: "2026-08-13T01:00:00.000Z", payload: { id: "task-123", cwd: "/tmp/project", timestamp: "2026-08-13T01:00:00.000Z" } }),
    JSON.stringify({ type: "event_msg", timestamp: "2026-08-13T01:01:00.000Z", payload: { type: "task_started" } }),
    JSON.stringify({ type: "event_msg", timestamp: "2026-08-13T01:02:00.000Z", payload: { type: "user_message", message: "  Build the console\nwith a read-only adapter  " } }),
    JSON.stringify({ type: "event_msg", timestamp: "2026-08-13T01:03:00.000Z", payload: { type: "task_complete" } })
  ].join("\n");
  const task = parseSessionJsonl(content, "/tmp/task-123.jsonl");
  assert.deepEqual({ id: task.id, title: task.title, status: task.status, cwd: task.cwd }, {
    id: "task-123",
    title: "Build the console with a read-only adapter",
    status: "completed",
    cwd: "/tmp/project"
  });
});

test("session adapter derives titles from current response items", () => {
  const content = [
    JSON.stringify({ type: "session_meta", timestamp: "2026-08-30T10:00:00.000Z", payload: { id: "modern-123", cwd: "/tmp/modern" } }),
    JSON.stringify({ type: "response_item", timestamp: "2026-08-30T10:00:01.000Z", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "  修复远端任务的标题\n并保持稳定  " }] } })
  ].join("\n");
  assert.equal(parseSessionJsonl(content).title, "修复远端任务的标题 并保持稳定");
});

test("session adapter adds a current display name without changing the dispatch project key", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codex-project-name-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, "renamed.jsonl"), [
    JSON.stringify({ type: "session_meta", timestamp: "2026-08-31T01:00:00Z", payload: { id: "renamed", cwd: "/workspace/mulitca" } }),
    JSON.stringify({ type: "response_item", timestamp: "2026-08-31T01:00:01Z", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "检查项目名" }] } })
  ].join("\n"));
  const adapter = new CodexTaskAdapter({
    sessionRoot: directory,
    projectNameIndex: { async read() { return { nameFor(cwd) { return cwd === "/workspace/mulitca" ? "看板" : null; } }; } }
  });
  const task = (await adapter.listTasks()).tasks[0];
  assert.equal(task.project, "mulitca");
  assert.equal(task.projectDisplayName, "看板");
});

test("session adapter overlays moved threads with current native project membership", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codex-current-project-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, "moved.jsonl"), [
    JSON.stringify({ type: "session_meta", timestamp: "2026-09-01T01:00:00Z", payload: { id: "moved", cwd: "/temporary/referenced-chat" } }),
    JSON.stringify({ type: "response_item", timestamp: "2026-09-01T01:00:01Z", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "实现实体系统" }] } })
  ].join("\n"));
  const adapter = new CodexTaskAdapter({
    sessionRoot: directory,
    projectNameIndex: { async read() { return { nameFor() { return "原项目"; } }; } },
    threadProjectIndex: { async read(ids) { assert.deepEqual(ids, ["moved"]); return { currentFor() { return { cwd: "D:\\333.开发\\真仙幸存者", projectId: "game", projectName: "真仙幸存者" }; } }; } }
  });
  const task = (await adapter.listTasks()).tasks[0];
  assert.equal(task.cwd, "D:\\333.开发\\真仙幸存者");
  assert.equal(task.project, "真仙幸存者");
  assert.equal(task.projectId, "game");
  assert.equal(task.projectDisplayName, "真仙幸存者");
});

test("session adapter exposes latest native settings and exact per-thread context state", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codex-session-settings-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const threadId = "01a04445-8d03-7243-a4d3-181180bb626d";
  const filePath = path.join(directory, `${threadId}.jsonl`);
  const records = [
    { type: "session_meta", timestamp: "2026-08-31T01:00:00Z", payload: { id: threadId, cwd: "/workspace/project" } },
    { type: "response_item", timestamp: "2026-08-31T01:00:01Z", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "检查远端设置" }] } },
    { type: "event_msg", timestamp: "2026-08-31T01:00:02Z", payload: { type: "thread_settings_applied", thread_settings: { model: "gpt-5.6-sol", reasoning_effort: "max", service_tier: "priority", approval_policy: "never", permission_profile: { type: "disabled" }, active_permission_profile: { id: ":danger-full-access" }, collaboration_mode: { settings: { developer_instructions: "private" } } } } },
    { type: "event_msg", timestamp: "2026-08-31T01:00:03Z", payload: { type: "token_count", info: { model_context_window: 950000 } } }
  ];
  await fs.writeFile(filePath, records.map(JSON.stringify).join("\n"));
  const adapter = new CodexTaskAdapter({
    sessionRoot: directory,
    contextWindowStore: { get(id) { return id === threadId ? { requestedContextWindow: 1_000_000 } : null; } },
    device: { id: "local", name: "Local", kind: "local-codex", location: "本机", status: "connected" }
  });
  const task = (await adapter.listTasks()).tasks[0];
  assert.deepEqual({
    model: task.model,
    reasoningEffort: task.reasoningEffort,
    serviceTier: task.serviceTier,
    approvalPolicy: task.approvalPolicy,
    permissionProfile: task.permissionProfile,
    accessMode: task.accessMode,
    contextOverrideState: task.contextOverrideState,
    requestedContextWindow: task.requestedContextWindow,
    modelContextWindow: task.modelContextWindow
  }, {
    model: "gpt-5.6-sol",
    reasoningEffort: "max",
    serviceTier: "priority",
    approvalPolicy: "never",
    permissionProfile: ":danger-full-access",
    accessMode: "full-access",
    contextOverrideState: "extended",
    requestedContextWindow: 1_000_000,
    modelContextWindow: 950000
  });
  const activity = await adapter.getActivity(threadId);
  assert.equal(activity.contextOverrideState, "extended");
  assert.equal(activity.accessMode, "full-access");
  assert.equal(JSON.stringify(activity).includes("developer_instructions"), false);
});

test("session adapter reuses unchanged parses and invalidates a changed file", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codex-session-cache-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "cached.jsonl");
  const content = (text) => [
    JSON.stringify({ type: "session_meta", payload: { id: "cached", cwd: "/tmp/cache" } }),
    JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text }] } })
  ].join("\n");
  await fs.writeFile(filePath, content("first title"));
  let reads = 0;
  const adapter = new CodexTaskAdapter({
    sessionRoot: directory,
    async readTaskFileImpl(target) {
      reads += 1;
      return parseSessionJsonl(await fs.readFile(target, "utf8"), target);
    }
  });
  assert.equal((await adapter.listTasks()).tasks[0].title, "first title");
  assert.equal((await adapter.listTasks()).tasks[0].title, "first title");
  assert.equal(reads, 1);
  await fs.writeFile(filePath, content("second title is longer"));
  assert.equal((await adapter.listTasks()).tasks[0].title, "second title is longer");
  assert.equal(reads, 2);
});

test("session adapter coalesces overlapping listings", async () => {
  let release;
  let reads = 0;
  const blocker = new Promise((resolve) => { release = resolve; });
  const adapter = new CodexTaskAdapter({ sessionRoot: "/sessions" });
  adapter.listTasksFresh = async () => { reads += 1; await blocker; return { status: "empty", tasks: [] }; };
  const first = adapter.listTasks();
  const second = adapter.listTasks();
  assert.equal(reads, 1);
  release();
  assert.deepEqual(await Promise.all([first, second]), [{ status: "empty", tasks: [] }, { status: "empty", tasks: [] }]);
});

test("indexed activity lookup reads the exact conversation without rescanning every session", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codex-activity-index-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const threadId = "01a05cc2-a041-7da3-bc6d-4fecf184d05c";
  await fs.writeFile(path.join(directory, `${threadId}.jsonl`), [
    JSON.stringify({ type: "session_meta", timestamp: "2026-09-02T01:00:00Z", payload: { id: threadId, cwd: "D:\\project" } }),
    JSON.stringify({ type: "response_item", timestamp: "2026-09-02T01:00:01Z", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "读取目标正文" }] } })
  ].join("\n"));
  const adapter = new CodexTaskAdapter({ sessionRoot: directory });
  await adapter.listTasks();
  adapter.listTasks = async () => { throw new Error("unexpected full rescan"); };
  const activity = await adapter.getActivity(threadId);
  assert.equal(activity.threadId, threadId);
  assert.equal(activity.entries.some((entry) => entry.text === "读取目标正文"), true);
});

test("active session listing and activity replace a stale bounded head sample with indexed settings", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codex-session-settings-long-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const threadId = "01a0299b-b536-7a11-8526-9b5ef4491a92";
  const filePath = path.join(directory, `${threadId}.jsonl`);
  const settings = (reasoningEffort, serviceTier) => JSON.stringify({
    type: "event_msg",
    timestamp: "2026-08-31T02:54:58Z",
    payload: {
      type: "thread_settings_applied",
      thread_settings: {
        model: "gpt-5.6-sol",
        reasoning_effort: reasoningEffort,
        service_tier: serviceTier,
        approval_policy: "never",
        active_permission_profile: { id: ":danger-full-access" }
      }
    }
  });
  const records = [
    JSON.stringify({ type: "session_meta", timestamp: "2026-08-31T00:00:00Z", payload: { id: threadId, cwd: "/workspace/project" } }),
    JSON.stringify({ type: "response_item", timestamp: "2026-08-31T00:00:01Z", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "自动驾驶" }] } }),
    settings("max", "priority"),
    JSON.stringify({ type: "response_item", payload: { type: "function_call_output", output: "x".repeat(16_000) } }),
    settings("medium", "default"),
    JSON.stringify({ type: "response_item", payload: { type: "function_call_output", output: "y".repeat(16_000) } }),
    JSON.stringify({ type: "response_item", timestamp: "2026-08-31T03:00:00Z", payload: { type: "message", role: "assistant", phase: "commentary", content: [{ type: "output_text", text: "正在继续" }] } })
  ];
  await fs.writeFile(filePath, `${records.join("\n")}\n`);
  const index = new SessionSettingsIndex({ filePath: path.join(directory, "settings-index.json"), chunkBytes: 1024, maxRecordBytes: 4096 });
  const adapter = new CodexTaskAdapter({ sessionRoot: directory, sessionSettingsIndex: index, maxBytesPerFile: 2048 });

  const sampled = (await adapter.listTasks()).tasks[0];
  assert.equal(sampled.reasoningEffort, "medium");
  assert.equal(sampled.serviceTier, "default");
  const activity = await adapter.getActivity(threadId);
  assert.equal(activity.reasoningEffort, "medium");
  assert.equal(activity.serviceTier, "default");
});

test("session adapter follows current response phases across resumed turns", () => {
  const base = JSON.stringify({ type: "session_meta", payload: { id: "phase-123", cwd: "/tmp/phase" } });
  const completed = [
    base,
    JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "开始" }] } }),
    JSON.stringify({ type: "response_item", payload: { type: "message", role: "assistant", phase: "final", content: [{ type: "output_text", text: "完成" }] } })
  ].join("\n");
  assert.equal(parseSessionJsonl(completed).status, "completed");
  const resumed = [
    completed,
    JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "继续" }] } }),
    JSON.stringify({ type: "response_item", payload: { type: "message", role: "assistant", phase: "commentary", content: [{ type: "output_text", text: "正在处理" }] } })
  ].join("\n");
  assert.equal(parseSessionJsonl(resumed).status, "active");
  const finishedAgain = `${resumed}\n${JSON.stringify({ type: "response_item", payload: { type: "message", role: "assistant", phase: "final", content: [{ type: "output_text", text: "再次完成" }] } })}`;
  assert.equal(parseSessionJsonl(finishedAgain).status, "completed");
});

test("session adapter skips transport-only context before the first real request", () => {
  const content = [
    JSON.stringify({ type: "session_meta", timestamp: "2026-08-30T10:00:00.000Z", payload: { id: "context-123", cwd: "/tmp/modern" } }),
    JSON.stringify({ type: "response_item", timestamp: "2026-08-30T10:00:01.000Z", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<recommended_plugins>generated list</recommended_plugins>\n<environment_context><cwd>/private</cwd></environment_context>" }] } }),
    JSON.stringify({ type: "response_item", timestamp: "2026-08-30T10:00:02.000Z", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "真正的项目请求" }] } })
  ].join("\n");
  assert.equal(parseSessionJsonl(content).title, "真正的项目请求");
});

test("session adapter extracts the explicit request from an attachment envelope", () => {
  const content = [
    JSON.stringify({ type: "session_meta", payload: { id: "image-123" } }),
    JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "# Files mentioned by the user:\n\n## My request:\n看一下任务的标题" }] } })
  ].join("\n");
  assert.equal(parseSessionJsonl(content).title, "看一下任务的标题");
});

test("session adapter retains the bounded id fallback without meaningful user text", () => {
  const content = [
    JSON.stringify({ type: "session_meta", payload: { id: "fallback-123456789" } }),
    JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>generated</environment_context>" }] } })
  ].join("\n");
  assert.equal(parseSessionJsonl(content).title, "任务 fallback");
});

test("session devices preserve the provider boundary needed by remote Codex nodes", () => {
  assert.deepEqual(normalizeSessionDevice({
    id: "linux:studio",
    name: "Studio Linux",
    kind: "codekanban-agent",
    location: "远程 Linux",
    status: "connected"
  }), {
    id: "linux:studio",
    name: "Studio Linux",
    kind: "codekanban-agent",
    location: "远程 Linux",
    status: "connected"
  });
});

test("project dispatch defaults to that project's latest conversation", () => {
  const tasks = [
    { id: "new", project: "demo", updatedAt: "2026-08-13T12:00:00Z" },
    { id: "old", project: "demo", updatedAt: "2026-08-12T12:00:00Z" },
    { id: "other", project: "other" }
  ];
  assert.equal(resolveDispatchTarget(tasks, { project: "demo" }).id, "new");
  assert.equal(resolveDispatchTarget(tasks, { project: "demo", targetThreadId: "old" }).id, "old");
  assert.equal(resolveDispatchTarget(tasks, { project: "demo", targetThreadId: "other" }), null);
});
