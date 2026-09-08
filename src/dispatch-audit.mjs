import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const EVENTS = new Set([
  "created", "scheduled", "queued", "claimed", "submitted", "completed",
  "failed", "cancelled", "delivery_unknown", "retry_requested", "deleted"
]);
const STATUSES = new Set([
  "backlog", "scheduled", "queued", "sending", "sent", "failed",
  "cancelled", "delivery_unknown"
]);

function bounded(value, maxLength) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maxLength);
}

export function normalizeDispatchAuditEvent(input, { now = () => new Date(), idFactory = () => crypto.randomUUID() } = {}) {
  const dispatchId = bounded(input?.dispatchId, 120);
  const type = bounded(input?.type, 40);
  if (!dispatchId || !EVENTS.has(type)) throw new Error("调度审计事件无效");
  const status = bounded(input?.status, 32);
  return Object.freeze({
    eventId: bounded(input?.eventId, 120) || idFactory(),
    dispatchId,
    attemptId: bounded(input?.attemptId, 120) || null,
    type,
    status: STATUSES.has(status) ? status : null,
    at: new Date(input?.at || now()).toISOString(),
    reason: bounded(input?.reason, 500) || null
  });
}

export class DispatchAuditStore {
  constructor({ filePath, now = () => new Date(), idFactory = () => crypto.randomUUID(), maxReadBytes = 256 * 1024 } = {}) {
    this.filePath = filePath;
    this.now = now;
    this.idFactory = idFactory;
    this.maxReadBytes = maxReadBytes;
    this.lastError = null;
    this.lastWriteAt = null;
  }

  async append(input) {
    try {
      const event = normalizeDispatchAuditEvent(input, { now: this.now, idFactory: this.idFactory });
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.appendFile(this.filePath, `${JSON.stringify(event)}\n`, { mode: 0o600 });
      await fs.chmod(this.filePath, 0o600);
      this.lastWriteAt = event.at;
      this.lastError = null;
      return event;
    } catch (error) {
      this.lastError = bounded(error.message, 500) || "审计记录写入失败";
      return null;
    }
  }

  async list(dispatchId, limit = 100) {
    const normalizedId = bounded(dispatchId, 120);
    const boundedLimit = Math.max(1, Math.min(Number(limit) || 100, 200));
    try {
      const stat = await fs.stat(this.filePath);
      const size = Math.min(stat.size, this.maxReadBytes);
      const handle = await fs.open(this.filePath, "r");
      let content;
      try {
        const buffer = Buffer.alloc(size);
        const result = await handle.read(buffer, 0, size, stat.size - size);
        content = buffer.subarray(0, result.bytesRead).toString("utf8");
      } finally {
        await handle.close();
      }
      if (size < stat.size) content = content.slice(content.indexOf("\n") + 1);
      const events = [];
      for (const line of content.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const event = normalizeDispatchAuditEvent(JSON.parse(line), { now: this.now, idFactory: this.idFactory });
          if (event.dispatchId === normalizedId) events.push(event);
        } catch {}
      }
      return events.slice(-boundedLimit);
    } catch (error) {
      if (error.code === "ENOENT") return [];
      this.lastError = bounded(error.message, 500) || "审计记录读取失败";
      return [];
    }
  }

  diagnostics() {
    return Object.freeze({
      status: this.lastError ? "degraded" : "ready",
      lastWriteAt: this.lastWriteAt,
      reason: this.lastError
    });
  }
}
