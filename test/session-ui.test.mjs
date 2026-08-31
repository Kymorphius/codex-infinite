import test from "node:test";
import assert from "node:assert/strict";
import { acceptedMessageLabel, conversationOwnerLabel, deviceHostLabel, filterSessions, groupSessionsByDevice, groupSessionsByDirectory, presentSessionSettings } from "../public/features/sessions/model.js";
import { SessionDisclosureState, summarizeSessionDevice } from "../public/features/sessions/disclosure.js";
import { conversationEntryKey, conversationEntrySignature, conversationTurnPresentation, presentConversationEntries, presentConversationEntry, shouldFollowConversationLatest } from "../public/features/sessions/conversation-model.js";
import { renderExecutionEntry } from "../public/features/sessions/execution-view.js";
import { approvalControlRequest, presentApproval } from "../public/features/sessions/approval-model.js";
import { mergeSessionSettings, settingsMenuOptions, settingsSavedLabel } from "../public/features/sessions/settings-controller.js";

const local = { id: "local", name: "Local", status: "connected", kind: "local-codex", location: "本机" };
const remote = { id: "remote", name: "Remote", status: "connected", kind: "remote-codex", location: "Linux" };
const tasks = [
  { id: "2", title: "new local", project: "beta", cwd: "/work/beta", model: "sol", status: "active", updatedAt: "2026-08-29T12:00:00Z", device: local },
  { id: "1", title: "old local", project: "alpha", cwd: "/work/alpha", model: "terra", status: "completed", updatedAt: "2026-08-28T12:00:00Z", device: local },
  { id: "3", title: "remote failure", project: "gamma", cwd: "/srv/gamma", model: "luna", status: "interrupted", updatedAt: "2026-08-30T12:00:00Z", device: remote }
];

test("session directories remain distinct and newest directory is first", () => {
  const groups = groupSessionsByDirectory(tasks.slice(0, 2));
  assert.deepEqual(groups.map((group) => group.directory), ["/work/beta", "/work/alpha"]);
  assert.deepEqual(groups.map((group) => group.tasks[0].id), ["2", "1"]);
});

test("session devices group normalized tasks and order by latest activity", () => {
  const devices = groupSessionsByDevice([local, remote], tasks);
  assert.deepEqual(devices.map((device) => device.id), ["remote", "local"]);
  assert.equal(devices[1].projects.length, 2);
});

test("an unavailable peer remains visible even without readable sessions", () => {
  const offline = { id: "offline", name: "Offline", status: "error", kind: "remote-codex", location: "远程" };
  const groups = groupSessionsByDevice([local, offline], tasks.filter((task) => task.device.id === "local"));
  assert.equal(groups.some((device) => device.id === "offline" && device.projects.length === 0), true);
});

test("session filtering searches metadata and normalizes interrupted as error", () => {
  assert.deepEqual(filterSessions(tasks, { query: "TERRA" }).map((task) => task.id), ["1"]);
  assert.deepEqual(filterSessions(tasks, { status: "active" }).map((task) => task.id), ["2"]);
  assert.deepEqual(filterSessions(tasks, { status: "error" }).map((task) => task.id), ["3"]);
});

test("device summaries stay useful while a device is collapsed", () => {
  const [device] = groupSessionsByDevice([local], tasks.filter((task) => task.device.id === "local"));
  assert.deepEqual(summarizeSessionDevice(device), {
    projectCount: 2,
    sessionCount: 2,
    activeCount: 1,
    latestAt: "2026-08-29T12:00:00Z"
  });
});

test("disclosure choices survive renders while filters temporarily reveal matches", () => {
  const disclosure = new SessionDisclosureState();
  disclosure.setDeviceOpen("local", false);
  disclosure.setProjectOpen("local", "/work/beta", false);
  assert.equal(disclosure.isDeviceOpen("local", { query: "", status: "all" }), false);
  assert.equal(disclosure.isProjectOpen("local", "/work/beta", true, { query: "", status: "all" }), false);
  assert.equal(disclosure.isDeviceOpen("local", { query: "beta", status: "all" }), true);
  assert.equal(disclosure.isProjectOpen("local", "/work/beta", false, { query: "beta", status: "all" }), true);
  assert.equal(disclosure.isDeviceOpen("local", { query: "", status: "all" }), false);
});

test("conversation activity is normalized into native-style presentation roles", () => {
  assert.deepEqual(presentConversationEntry({ kind: "message", role: "assistant", phase: "commentary", text: "Working" }), {
    kind: "message", role: "assistant", label: "Codex · 进行中", text: "Working", timestamp: null
  });
  assert.deepEqual(presentConversationEntry({ kind: "message", role: "user", text: "Continue" }), {
    kind: "message", role: "user", label: "你", text: "Continue", timestamp: null
  });
  assert.equal(presentConversationEntry({ kind: "tool", name: "shell", status: "completed" }).text, "shell · completed");
  assert.equal(presentConversationEntry({ kind: "status", status: "completed" }).text, "本轮已完成");
});

test("conversation presentation hides transport context and keeps every tool operation", () => {
  const entries = presentConversationEntries([
    { kind: "message", role: "user", text: "<environment_context>private transport state</environment_context>\n\nContinue" },
    { id: "tool-1", kind: "tool", name: "exec", status: "completed", input: "pwd", output: "/work\n", timestamp: "one" },
    { id: "tool-2", kind: "tool", name: "exec", status: "completed", input: "npm test", output: "pass", timestamp: "two" },
    { kind: "message", role: "assistant", text: "Done" }
  ]);
  assert.equal(entries[0].text, "Continue");
  assert.equal(entries.length, 4);
  assert.equal(entries[1].input, "pwd");
  assert.equal(entries[1].output, "/work\n");
  assert.equal(entries[2].input, "npm test");
  assert.equal(entries[3].text, "Done");
});

test("conversation entries retain stable incremental render identity and bounded turn labels", () => {
  const entry = presentConversationEntry({ id: "message-1", kind: "message", role: "assistant", phase: "commentary", text: "Working" });
  assert.equal(conversationEntryKey(entry, 4), "message:message-1");
  assert.equal(conversationEntrySignature(entry), conversationEntrySignature({ ...entry }));
  assert.notEqual(conversationEntrySignature(entry), conversationEntrySignature({ ...entry, text: "Done" }));
  const execution = presentConversationEntry({ id: "call-1", kind: "tool", name: "exec", status: "completed", input: "pwd", output: "/work" });
  assert.notEqual(conversationEntrySignature(execution), conversationEntrySignature({ ...execution, output: "/other" }));
  assert.deepEqual(conversationTurnPresentation("active"), { label: "进行中", tone: "active" });
  assert.deepEqual(conversationTurnPresentation("interrupted"), { label: "已中断", tone: "interrupted" });
  assert.equal(presentConversationEntry({ kind: "status", status: "interrupted" }).text, "本轮已中断");
});

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.className = "";
    this.textContent = "";
    this.tabIndex = -1;
    this.dateTime = "";
  }

  append(...children) { this.children.push(...children); }
}

function findByClass(root, className) {
  if (String(root.className).split(/\s+/).includes(className)) return root;
  for (const child of root.children || []) {
    const match = findByClass(child, className);
    if (match) return match;
  }
  return null;
}

test("execution cards render exact recorded HTML-like content as selectable text", () => {
  const documentRef = { createElement: (tagName) => new FakeElement(tagName) };
  const input = "  <script>alert('input')</script>\n";
  const output = "<b>raw output</b>\n\u0000";
  const item = renderExecutionEntry({
    id: "tool-1",
    kind: "tool",
    role: "system",
    name: "exec_command",
    status: "completed",
    input,
    output,
    inputTruncated: false,
    outputTruncated: true,
    timestamp: "2026-08-31T12:00:00Z"
  }, 0, { formatDate: (value) => value, documentRef });

  const rawBlocks = [];
  const collect = (node) => {
    if (String(node.className).split(/\s+/).includes("execution-raw")) rawBlocks.push(node);
    for (const child of node.children || []) collect(child);
  };
  collect(item);
  assert.equal(item.dataset.entryKey, "tool:tool-1");
  assert.deepEqual(rawBlocks.map((block) => block.textContent), [input, output]);
  assert.equal(rawBlocks.every((block) => block.tagName === "PRE" && block.tabIndex === 0), true);
  assert.equal(findByClass(item, "execution-truncated").textContent, "内容过长，已截断");
});

test("conversation refresh follows new messages only while the reader remains near the latest entry", () => {
  assert.equal(shouldFollowConversationLatest({ quiet: false, scrollHeight: 1000, scrollTop: 0, clientHeight: 400 }), true);
  assert.equal(shouldFollowConversationLatest({ quiet: true, scrollHeight: 1000, scrollTop: 570, clientHeight: 400 }), true);
  assert.equal(shouldFollowConversationLatest({ quiet: true, scrollHeight: 1000, scrollTop: 200, clientHeight: 400 }), false);
});

test("native owner runtime labels describe execution without claiming feature installation", () => {
  const device = { ...remote, runtime: { authority: "owner-native-desktop", featurePolicy: "owner-native" } };
  const task = { device };
  assert.equal(deviceHostLabel(device), "完整 Codex 桌面宿主");
  assert.equal(conversationOwnerLabel(task), "Remote · 原生 Codex 执行");
  assert.equal(acceptedMessageLabel(task, { executionAuthority: "owner-native-desktop" }), "Remote 的原生 Codex 已接收");
  assert.equal(deviceHostLabel(remote), "原生 Codex");
});

test("remote session settings use native labels without inventing unavailable state", () => {
  const settings = presentSessionSettings({
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
  assert.deepEqual(settings.map((item) => item.text), ["gpt-5.6-sol", "推理 max", "速度 快速", "完全访问", "百万上下文 开"]);
  assert.equal(settings.find((item) => item.key === "access").title, "配置 :danger-full-access · 审批 never");
  assert.equal(settings.find((item) => item.key === "context").title, "请求 1M · 已观察 950K");
  assert.deepEqual(presentSessionSettings({}).map((item) => item.text), ["模型未记录", "推理未记录", "速度未记录", "权限未记录", "百万上下文 未记录"]);
  assert.equal(presentSessionSettings({ contextOverrideState: "default" }).at(-1).text, "百万上下文 关");
  assert.equal(presentSessionSettings({ contextOverrideState: "extended", requestedContextWindow: 512_000 }).at(-1).text, "扩展上下文 512K");
});

test("native-style setting menus use only owner-advertised choices", () => {
  const current = mergeSessionSettings(
    { model: "fallback", accessMode: "workspace", contextOverrideState: "default" },
    { model: "gpt-5.6-sol", reasoningEffort: "high", serviceTier: "priority", accessMode: "full-access", contextOverrideState: "extended", requestedContextWindow: 1_000_000 }
  );
  const options = {
    models: [{ id: "gpt-5.6-sol", displayName: "Sol", description: "Frontier", defaultReasoningEffort: "high", reasoningEfforts: [{ effort: "low", description: null }, { effort: "high", description: "Deep" }], serviceTiers: [{ id: "default", name: "Standard", description: "Default speed" }, { id: "priority", name: "Fast", description: "1.5x" }] }],
    accessModes: ["read-only", "workspace", "full-access"],
    contextWindow: 1_000_000
  };
  assert.equal(current.model, "gpt-5.6-sol");
  assert.deepEqual(settingsMenuOptions("model", current, options).map((item) => [item.label, item.selected]), [["Sol", true]]);
  assert.deepEqual(settingsMenuOptions("reasoning", current, options).map((item) => [item.value, item.selected]), [["low", false], ["high", true]]);
  assert.deepEqual(settingsMenuOptions("speed", current, options).map((item) => [item.label, item.selected]), [["标准", false], ["快速", true]]);
  assert.deepEqual(settingsMenuOptions("access", current, options).map((item) => item.label), ["只读", "工作区访问", "完全访问"]);
  assert.equal(settingsMenuOptions("context", current, options)[1].description, "1,000,000 tokens，仅当前会话");
  assert.deepEqual(settingsMenuOptions("model", current, null), []);
  assert.equal(settingsSavedLabel(true), "已保存，下轮生效");
  assert.equal(settingsSavedLabel(false), "已保存，将用于下一轮");
});

test("remote approvals present useful details and emit only one-turn control contracts", () => {
  const approval = {
    token: "01a04447-8d03-7243-a4d3-181180bb626f",
    kind: "command",
    turnId: "01a04446-8d03-7243-a4d3-181180bb626e",
    reason: "运行项目测试",
    command: "npm test",
    cwd: "/workspace/project",
    networkHost: null,
    permissionSummary: ["写入 /workspace/project/dist"],
    decisions: ["accept", "decline"]
  };
  const presented = presentApproval(approval, "MacBook Pro");
  assert.equal(presented.title, "运行命令");
  assert.equal(presented.device, "MacBook Pro");
  assert.equal(presented.scope, "仅允许这一次，不会更改长期规则");
  assert.deepEqual(presented.facts.map((fact) => fact.label), ["命令", "目录", "权限"]);
  assert.equal(presented.canAccept, true);
  const request = approvalControlRequest({ id: "thread/one", device: { id: "forest mac" } }, approval, "accept");
  assert.equal(request.url, "/api/tasks/thread%2Fone/control?device=forest%20mac");
  assert.deepEqual(request.body, {
    action: "resolveApproval",
    turnId: approval.turnId,
    approvalToken: approval.token,
    decision: "accept"
  });
  assert.throws(() => approvalControlRequest({ id: "thread", device: { id: "peer" } }, { ...approval, decisions: ["decline"] }, "accept"), /无效/);
});
