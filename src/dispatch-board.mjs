import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export const DISPATCH_STATUSES = Object.freeze(["backlog", "scheduled", "queued", "sending", "sent", "failed", "cancelled", "delivery_unknown"]);
export const MANUAL_DISPATCH_STATUSES = Object.freeze(["backlog", "scheduled", "queued", "cancelled"]);
export const EDITABLE_DISPATCH_STATUSES = Object.freeze(["backlog", "scheduled"]);

const MANUAL_TRANSITIONS = Object.freeze({
  backlog: Object.freeze(["backlog", "scheduled", "queued", "cancelled"]),
  scheduled: Object.freeze(["backlog", "scheduled", "queued", "cancelled"]),
  queued: Object.freeze(["backlog", "cancelled"]),
  failed: Object.freeze(["backlog", "queued", "cancelled"]),
  cancelled: Object.freeze(["backlog", "queued"]),
  delivery_unknown: Object.freeze(["queued", "cancelled"]),
  sending: Object.freeze([]),
  sent: Object.freeze([])
});

function cleanText(value, maxLength) {
  return String(value || "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, maxLength);
}

function validDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function initialDispatchStatus({ mode, scheduledAt }, now = new Date()) {
  if (mode === "backlog") return "backlog";
  const sendAt = validDate(scheduledAt);
  if (sendAt && new Date(sendAt).getTime() > now.getTime()) return "scheduled";
  return "queued";
}

export function validateDispatchInput(input, now = new Date()) {
  const title = cleanText(input?.title, 160);
  const prompt = cleanText(input?.prompt, 12000);
  const project = cleanText(input?.project, 200);
  const targetThreadId = cleanText(input?.targetThreadId, 120);
  const targetThreadTitle = cleanText(input?.targetThreadTitle, 240);
  const cwd = cleanText(input?.cwd, 2048);
  const scheduledAt = validDate(input?.scheduledAt);
  if (!title) throw new Error("任务标题不能为空");
  if (!prompt) throw new Error("发送内容不能为空");
  if (!project) throw new Error("必须选择项目");
  if (!targetThreadId) throw new Error("目标项目没有可用对话");
  if (input?.scheduledAt && !scheduledAt) throw new Error("排期时间无效");
  return {
    title,
    prompt,
    project,
    targetThreadId,
    targetThreadTitle: targetThreadTitle || `对话 ${targetThreadId.slice(0, 8)}`,
    cwd: cwd || null,
    scheduledAt,
    status: initialDispatchStatus({ mode: input?.mode, scheduledAt }, now)
  };
}

export function normalizeDispatchChanges(item, changes, now = new Date()) {
  const patch = {};
  const contentKeys = ["title", "prompt", "project", "targetThreadId", "targetThreadTitle", "cwd"];
  const changesContent = contentKeys.some((key) => Object.hasOwn(changes, key));
  if (changesContent && !EDITABLE_DISPATCH_STATUSES.includes(item.status)) throw new Error("请先将任务移到待排期后再编辑");

  if (changesContent) {
    const normalized = validateDispatchInput({ ...item, ...changes, mode: "backlog" }, now);
    for (const key of contentKeys) if (Object.hasOwn(changes, key)) patch[key] = normalized[key];
  }

  const hasScheduledAt = Object.hasOwn(changes, "scheduledAt");
  let scheduledAt = hasScheduledAt ? validDate(changes.scheduledAt) : item.scheduledAt;
  if (hasScheduledAt && changes.scheduledAt && !scheduledAt) throw new Error("排期时间无效");
  let status = Object.hasOwn(changes, "status") ? changes.status : null;
  if (status && !MANUAL_DISPATCH_STATUSES.includes(status)) throw new Error("任务状态不能手动设置");
  if (status && !MANUAL_TRANSITIONS[item.status]?.includes(status)) throw new Error("当前任务状态不允许这样调整");
  if (!status && hasScheduledAt) status = scheduledAt ? "scheduled" : "backlog";
  if (status === "scheduled") {
    if (!scheduledAt || new Date(scheduledAt).getTime() <= now.getTime()) throw new Error("排期时间必须晚于当前时间");
    patch.scheduledAt = scheduledAt;
  } else if (status && ["backlog", "queued", "cancelled"].includes(status)) {
    patch.scheduledAt = null;
  } else if (hasScheduledAt) {
    patch.scheduledAt = scheduledAt;
  }
  if (status) patch.status = status;
  return patch;
}

export class DispatchBoardStore {
  constructor({ filePath, auditStore = null, now = () => new Date(), idFactory = () => crypto.randomUUID(), attemptIdFactory = () => crypto.randomUUID() }) {
    this.filePath = filePath;
    this.auditStore = auditStore;
    this.now = now;
    this.idFactory = idFactory;
    this.attemptIdFactory = attemptIdFactory;
    this.items = [];
    this.ready = false;
  }

  async init() {
    if (this.ready) return;
    try {
      const data = JSON.parse(await fs.readFile(this.filePath, "utf8"));
      this.items = Array.isArray(data.items) ? data.items : [];
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      this.items = [];
    }
    const recovered = [];
    for (const item of this.items) {
      item.attemptCount = Math.max(0, Number(item.attemptCount) || 0);
      item.activeAttemptId = cleanText(item.activeAttemptId, 120) || null;
      item.deliveryUncertainAt = validDate(item.deliveryUncertainAt);
      if (item.status === "sending") {
        item.status = "delivery_unknown";
        item.deliveryUncertainAt = this.now().toISOString();
        item.updatedAt = item.deliveryUncertainAt;
        item.lastError = "控制台在发送期间重启，交付结果未知。请核对目标对话后明确选择是否重试。";
        recovered.push(item);
      }
    }
    this.ready = true;
    await this.save();
    for (const item of recovered) await this.audit("delivery_unknown", item, item.lastError);
  }

  async save() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify({ version: 2, items: this.items }, null, 2), { mode: 0o600 });
    await fs.rename(temporaryPath, this.filePath);
  }

  list() {
    return [...this.items].sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  }

  get(id) {
    return this.items.find((candidate) => candidate.id === id) || null;
  }

  async audit(type, item, reason = null) {
    await this.auditStore?.append?.({
      dispatchId: item.id,
      attemptId: item.activeAttemptId,
      type,
      status: item.status,
      at: this.now().toISOString(),
      reason
    });
  }

  async create(input) {
    const now = this.now();
    const normalized = validateDispatchInput(input, now);
    const item = {
      id: this.idFactory(),
      ...normalized,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      startedAt: null,
      completedAt: null,
      lastError: null,
      attemptCount: 0,
      activeAttemptId: null,
      deliveryUncertainAt: null
    };
    this.items.push(item);
    await this.save();
    await this.audit(normalized.status === "scheduled" ? "scheduled" : normalized.status === "queued" ? "queued" : "created", item);
    return item;
  }

  async update(id, changes) {
    const item = this.get(id);
    if (!item) return null;
    if (item.status === "sending") throw new Error("正在发送的任务不能修改");
    const previousStatus = item.status;
    Object.assign(item, normalizeDispatchChanges(item, changes, this.now()));
    item.updatedAt = this.now().toISOString();
    item.lastError = null;
    await this.save();
    if (item.status !== previousStatus) {
      const type = previousStatus === "delivery_unknown" && item.status === "queued" ? "retry_requested" : item.status === "cancelled" ? "cancelled" : item.status === "scheduled" ? "scheduled" : item.status === "queued" ? "queued" : "created";
      await this.audit(type, item);
    }
    return item;
  }

  async remove(id) {
    const index = this.items.findIndex((candidate) => candidate.id === id);
    if (index < 0) return false;
    if (this.items[index].status === "sending") throw new Error("正在发送的任务不能删除");
    const [item] = this.items.splice(index, 1);
    await this.save();
    await this.audit("deleted", item);
    return true;
  }

  async promoteDue() {
    const nowMs = this.now().getTime();
    let changed = false;
    const promoted = [];
    for (const item of this.items) {
      if (item.status === "scheduled" && item.scheduledAt && new Date(item.scheduledAt).getTime() <= nowMs) {
        item.status = "queued";
        item.updatedAt = new Date(nowMs).toISOString();
        promoted.push(item);
        changed = true;
      }
    }
    if (changed) {
      await this.save();
      for (const item of promoted) await this.audit("queued", item);
    }
  }

  async claimNext() {
    const item = this.items.filter((candidate) => candidate.status === "queued").sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)))[0];
    if (!item) return null;
    item.status = "sending";
    item.attemptCount = Math.max(0, Number(item.attemptCount) || 0) + 1;
    item.activeAttemptId = this.attemptIdFactory();
    item.deliveryUncertainAt = null;
    item.startedAt = this.now().toISOString();
    item.updatedAt = item.startedAt;
    await this.save();
    await this.audit("claimed", item);
    return item;
  }

  async finish(id, { ok, error = null, attemptId = null }) {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item) return null;
    if (item.activeAttemptId && item.activeAttemptId !== attemptId) return null;
    if (item.status !== "sending") return null;
    item.status = ok ? "sent" : "failed";
    item.completedAt = this.now().toISOString();
    item.updatedAt = item.completedAt;
    item.lastError = ok ? null : cleanText(error, 2000) || "Codex 发送失败";
    await this.save();
    await this.audit(ok ? "completed" : "failed", item, ok ? null : "Codex 调度失败");
    return item;
  }

  diagnostics() {
    return Object.freeze({
      status: this.ready ? "ready" : "unavailable",
      queued: this.items.filter((item) => item.status === "queued").length,
      sending: this.items.filter((item) => item.status === "sending").length,
      deliveryUnknown: this.items.filter((item) => item.status === "delivery_unknown").length
    });
  }
}
