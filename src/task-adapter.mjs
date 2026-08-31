import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { enrichTaskForBoard } from "./board.mjs";
import { buildProjectPriorities } from "./priority.mjs";
import { parseConversationActivity } from "./conversation-activity.mjs";
import { boundedSessionTitle, userTextFromSessionRecord } from "./session-title.mjs";
import { normalizeThreadSettings } from "./thread-settings.mjs";

const DEFAULT_MAX_FILES = 160;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_ACTIVITY_BYTES = 2 * 1024 * 1024;

function defaultDevice() {
  const hostname = os.hostname() || "本机";
  return Object.freeze({
    id: `local:${hostname}`,
    name: hostname,
    kind: "local-codex",
    location: "本机",
    status: "connected"
  });
}

export function normalizeSessionDevice(device = defaultDevice()) {
  const fallback = defaultDevice();
  return Object.freeze({
    id: String(device?.id || fallback.id),
    name: String(device?.name || fallback.name),
    kind: String(device?.kind || fallback.kind),
    location: String(device?.location || fallback.location),
    status: String(device?.status || fallback.status)
  });
}

function statusFromEvent(type, current) {
  if (["task_complete", "task_completed", "turn_complete"].includes(type)) return "completed";
  if (["task_failed", "error", "turn_failed"].includes(type)) return "error";
  if (["turn_aborted", "task_aborted"].includes(type)) return "interrupted";
  if (["task_started", "turn_started", "user_message"].includes(type)) return "active";
  return current;
}

function statusFromResponseItem(payload, current) {
  if (!payload) return current;
  if (payload.type === "message" && payload.role === "user") return "active";
  if (payload.type === "message" && payload.role === "assistant") {
    if (payload.phase === "final") return "completed";
    if (payload.phase === "commentary") return "active";
  }
  if (["reasoning", "custom_tool_call", "custom_tool_call_output", "function_call", "function_call_output"].includes(payload.type)) return "active";
  return current;
}

export function parseSessionJsonl(content, filePath = "") {
  let meta = null;
  let firstUserMessage = "";
  let status = "unknown";
  let lastTimestamp = null;
  let recordCount = 0;
  let threadSettings = null;
  let modelContextWindow = null;
  for (const line of String(content).split(/\r?\n/)) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    recordCount += 1;
    lastTimestamp = record.timestamp || lastTimestamp;
    if (record.type === "session_meta" && record.payload && !meta) meta = record.payload;
    if (!firstUserMessage) firstUserMessage = userTextFromSessionRecord(record);
    if (record.type === "response_item") status = statusFromResponseItem(record.payload, status);
    if (record.type === "event_msg" && record.payload) {
      const eventType = record.payload.type;
      status = statusFromEvent(eventType, status);
      if (eventType === "thread_settings_applied") {
        threadSettings = normalizeThreadSettings(record.payload.thread_settings);
      }
      if (eventType === "token_count") {
        modelContextWindow = record.payload.info?.model_context_window || modelContextWindow;
      }
    }
  }
  if (!meta) return null;
  const id = meta.id || meta.session_id || path.basename(filePath, ".jsonl");
  const fallback = `任务 ${String(id).slice(0, 8)}`;
  return {
    id: String(id),
    title: boundedSessionTitle(firstUserMessage, fallback),
    status,
    cwd: typeof meta.cwd === "string" ? meta.cwd : null,
    createdAt: meta.timestamp || lastTimestamp || null,
    updatedAt: lastTimestamp || meta.timestamp || null,
    sourceFile: filePath || null,
    recordCount,
    model: threadSettings?.model || meta.base_instructions?.provenance?.model || null,
    reasoningEffort: threadSettings?.reasoningEffort || null,
    serviceTier: threadSettings?.serviceTier || null,
    approvalPolicy: threadSettings?.approvalPolicy || null,
    permissionProfile: threadSettings?.permissionProfile || null,
    accessMode: threadSettings?.accessMode || "unknown",
    modelContextWindow
  };
}

async function collectJsonlFiles(root, output = []) {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return output;
    throw error;
  }
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) await collectJsonlFiles(fullPath, output);
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) output.push(fullPath);
  }
  return output;
}

async function readTaskFile(filePath, maxBytes) {
  const stat = await fs.stat(filePath);
  let content;
  if (stat.size <= maxBytes) content = await fs.readFile(filePath, "utf8");
  else {
    const handle = await fs.open(filePath, "r");
    try {
      const headSize = Math.floor(maxBytes / 2);
      const tailSize = maxBytes - headSize;
      const head = Buffer.alloc(headSize);
      const tail = Buffer.alloc(tailSize);
      const headRead = await handle.read(head, 0, headSize, 0);
      const tailRead = await handle.read(tail, 0, tailSize, Math.max(0, stat.size - tailSize));
      content = `${head.subarray(0, headRead.bytesRead).toString("utf8")}\n${tail.subarray(0, tailRead.bytesRead).toString("utf8")}`;
    } finally {
      await handle.close();
    }
  }
  const task = parseSessionJsonl(content, filePath);
  if (!task) return null;
  task.updatedAt = task.updatedAt || stat.mtime.toISOString();
  return task;
}

async function readFileTail(filePath, maxBytes = DEFAULT_ACTIVITY_BYTES) {
  const stat = await fs.stat(filePath);
  if (stat.size <= maxBytes) return fs.readFile(filePath, "utf8");
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, stat.size - maxBytes);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

export class CodexTaskAdapter {
  constructor({ sessionRoot, archivedSessionRoot, titleIndex, runtimeStatusProvider, contextWindowStore = null, sessionSettingsIndex = null, maxFiles = DEFAULT_MAX_FILES, maxBytesPerFile = DEFAULT_MAX_BYTES, device } = {}) {
    this.sessionRoot = sessionRoot;
    this.archivedSessionRoot = archivedSessionRoot;
    this.maxFiles = maxFiles;
    this.maxBytesPerFile = maxBytesPerFile;
    this.titleIndex = titleIndex;
    this.runtimeStatusProvider = runtimeStatusProvider;
    this.contextWindowStore = contextWindowStore;
    this.sessionSettingsIndex = sessionSettingsIndex;
    this.device = normalizeSessionDevice(device);
  }

  contextProjection(threadId) {
    if (!this.contextWindowStore?.get) return { contextOverrideState: "unknown", requestedContextWindow: null };
    try {
      const item = this.contextWindowStore.get(threadId);
      return item
        ? { contextOverrideState: "extended", requestedContextWindow: item.requestedContextWindow }
        : { contextOverrideState: "default", requestedContextWindow: null };
    } catch {
      return { contextOverrideState: "unknown", requestedContextWindow: null };
    }
  }

  async listTasks() {
    if (!this.sessionRoot) {
      return { status: "disconnected", source: "codex-session-metadata-read-only", readOnly: true, tasks: [], projects: [], devices: [{ ...this.device, status: "disconnected" }], message: "未配置 Codex 本地任务目录。" };
    }
    try {
      const files = await collectJsonlFiles(this.sessionRoot);
      if (this.archivedSessionRoot) await collectJsonlFiles(this.archivedSessionRoot, files);
      const stats = await Promise.all(files.map(async (filePath) => ({ filePath, stat: await fs.stat(filePath) })));
      stats.sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs);
      const indexedTitles = await this.titleIndex?.read() || new Map();
      const runtimeStatuses = await this.runtimeStatusProvider?.readThreadStatuses() || new Map();
      const tasks = [];
      for (const { filePath } of stats.slice(0, this.maxFiles)) {
        let task = await readTaskFile(filePath, this.maxBytesPerFile);
        const status = task ? runtimeStatuses.get(task.id) || task.status : null;
        if (task && status === "active" && this.sessionSettingsIndex?.read) {
          try {
            const latest = await this.sessionSettingsIndex.read(task.sourceFile);
            if (latest) task = { ...task, ...latest };
          } catch {}
        }
        if (task) tasks.push({
          ...enrichTaskForBoard({ ...task, title: indexedTitles.get(task.id) || task.title, status }),
          ...this.contextProjection(task.id),
          device: this.device
        });
      }
      tasks.sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
      if (tasks.length === 0) {
        return { status: "empty", source: "codex-session-metadata-read-only", readOnly: true, tasks: [], projects: [], devices: [this.device], message: "尚未发现可读取的 Codex 任务记录。" };
      }
      return { status: "connected", source: "codex-session-metadata-read-only", readOnly: true, tasks, projects: buildProjectPriorities(tasks), devices: [this.device] };
    } catch (error) {
      return { status: "error", source: "codex-session-metadata-read-only", readOnly: true, tasks: [], projects: [], devices: [{ ...this.device, status: "error" }], message: `读取 Codex 任务记录失败：${error.message}` };
    }
  }

  async getTask(id) {
    const result = await this.listTasks();
    const task = result.tasks.find((candidate) => candidate.id === id) || null;
    if (!task?.sourceFile || !this.sessionSettingsIndex?.read) return task;
    const latest = await this.sessionSettingsIndex.read(task.sourceFile);
    return latest ? { ...task, ...latest } : task;
  }

  async getActivity(id) {
    const task = await this.getTask(id);
    if (!task?.sourceFile) return null;
    const activity = parseConversationActivity(await readFileTail(task.sourceFile), { threadId: task.id });
    return {
      ...activity,
      title: task.title,
      updatedAt: task.updatedAt,
      model: task.model,
      reasoningEffort: task.reasoningEffort,
      serviceTier: task.serviceTier,
      approvalPolicy: task.approvalPolicy,
      permissionProfile: task.permissionProfile,
      accessMode: task.accessMode,
      contextOverrideState: task.contextOverrideState,
      requestedContextWindow: task.requestedContextWindow,
      modelContextWindow: task.modelContextWindow,
      device: this.device
    };
  }
}
