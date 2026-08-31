import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export const DISPATCH_STATUSES = Object.freeze(["backlog", "scheduled", "queued", "sending", "sent", "failed", "cancelled"]);

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

export class DispatchBoardStore {
  constructor({ filePath, now = () => new Date(), idFactory = () => crypto.randomUUID() }) {
    this.filePath = filePath;
    this.now = now;
    this.idFactory = idFactory;
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
    for (const item of this.items) {
      if (item.status === "sending") {
        item.status = "queued";
        item.lastError = "控制台重启，任务已重新加入队列。";
      }
    }
    this.ready = true;
    await this.save();
  }

  async save() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify({ version: 1, items: this.items }, null, 2), { mode: 0o600 });
    await fs.rename(temporaryPath, this.filePath);
  }

  list() {
    return [...this.items].sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
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
      lastError: null
    };
    this.items.push(item);
    await this.save();
    return item;
  }

  async update(id, changes) {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item) return null;
    if (item.status === "sending") throw new Error("正在发送的任务不能修改");
    if (changes.status && !DISPATCH_STATUSES.includes(changes.status)) throw new Error("任务状态无效");
    if (changes.status) item.status = changes.status;
    if (Object.hasOwn(changes, "scheduledAt")) {
      const scheduledAt = validDate(changes.scheduledAt);
      if (changes.scheduledAt && !scheduledAt) throw new Error("排期时间无效");
      item.scheduledAt = scheduledAt;
    }
    item.updatedAt = this.now().toISOString();
    item.lastError = null;
    await this.save();
    return item;
  }

  async remove(id) {
    const index = this.items.findIndex((candidate) => candidate.id === id);
    if (index < 0) return false;
    if (this.items[index].status === "sending") throw new Error("正在发送的任务不能删除");
    this.items.splice(index, 1);
    await this.save();
    return true;
  }

  async promoteDue() {
    const nowMs = this.now().getTime();
    let changed = false;
    for (const item of this.items) {
      if (item.status === "scheduled" && item.scheduledAt && new Date(item.scheduledAt).getTime() <= nowMs) {
        item.status = "queued";
        item.updatedAt = new Date(nowMs).toISOString();
        changed = true;
      }
    }
    if (changed) await this.save();
  }

  async claimNext() {
    const item = this.items.filter((candidate) => candidate.status === "queued").sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)))[0];
    if (!item) return null;
    item.status = "sending";
    item.startedAt = this.now().toISOString();
    item.updatedAt = item.startedAt;
    await this.save();
    return item;
  }

  async finish(id, { ok, error = null }) {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item) return null;
    item.status = ok ? "sent" : "failed";
    item.completedAt = this.now().toISOString();
    item.updatedAt = item.completedAt;
    item.lastError = ok ? null : cleanText(error, 2000) || "Codex 发送失败";
    await this.save();
    return item;
  }
}
