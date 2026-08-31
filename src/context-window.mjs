import fs from "node:fs/promises";
import path from "node:path";

export const MIN_CONTEXT_WINDOW = 32_000;
export const MAX_CONTEXT_WINDOW = 2_000_000;

function cleanThreadId(value) {
  const threadId = String(value || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(threadId)) {
    throw new Error("会话 ID 必须是有效 UUID");
  }
  return threadId.toLowerCase();
}

export function validateContextWindow(value) {
  const contextWindow = typeof value === "number" ? value : Number(String(value || "").replaceAll(",", ""));
  if (!Number.isSafeInteger(contextWindow) || contextWindow < MIN_CONTEXT_WINDOW || contextWindow > MAX_CONTEXT_WINDOW) {
    throw new Error(`上下文窗口必须是 ${MIN_CONTEXT_WINDOW.toLocaleString("en-US")}–${MAX_CONTEXT_WINDOW.toLocaleString("en-US")} 之间的整数`);
  }
  return contextWindow;
}

export class ModelCatalog {
  constructor({ filePath }) {
    this.filePath = filePath;
  }

  async readModels() {
    if (!this.filePath) return [];
    try {
      const data = JSON.parse(await fs.readFile(this.filePath, "utf8"));
      const models = Array.isArray(data) ? data : data.models;
      return Array.isArray(models) ? models : [];
    } catch {
      return [];
    }
  }

  async get(slug) {
    if (!slug) return null;
    return (await this.readModels()).find((model) => model.slug === slug) || null;
  }

  async listOptions({ limit = 16 } = {}) {
    const clean = (value, maxLength) => typeof value === "string"
      ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, maxLength)
      : "";
    return (await this.readModels()).flatMap((model) => {
      const id = clean(model?.slug, 120);
      if (!id || model?.visibility === "hide" || model?.supported_in_api === false) return [];
      const efforts = (Array.isArray(model?.supported_reasoning_levels) ? model.supported_reasoning_levels : []).flatMap((item) => {
        const effort = clean(item?.effort, 40);
        return effort ? [{ effort, description: clean(item?.description, 180) || null }] : [];
      }).slice(0, 8);
      const fallbackEffort = clean(model?.default_reasoning_level, 40) || efforts[0]?.effort || null;
      const serviceTiers = [
        { id: "default", name: "Standard", description: "Default speed" },
        ...(Array.isArray(model?.service_tiers) ? model.service_tiers : [])
      ].flatMap((item) => {
        const rawId = clean(item?.id, 40).toLowerCase();
        const id = rawId === "fast" ? "priority" : rawId;
        if (!["default", "priority", "ultrafast"].includes(id)) return [];
        return [{ id, name: clean(item?.name, 80) || id, description: clean(item?.description, 180) || null }];
      }).filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index).slice(0, 4);
      return [{
        id,
        displayName: clean(model?.display_name, 120) || id,
        description: clean(model?.description, 240) || null,
        defaultReasoningEffort: fallbackEffort,
        reasoningEfforts: efforts,
        serviceTiers
      }];
    }).slice(0, Math.max(1, Math.min(16, Number(limit) || 16)));
  }

  async resolve(slug, requestedContextWindow) {
    const model = await this.get(slug);
    const maxContextWindow = Number.isSafeInteger(model?.max_context_window) ? model.max_context_window : null;
    const effectivePercent = Number.isSafeInteger(model?.effective_context_window_percent)
      ? model.effective_context_window_percent
      : 100;
    const acceptedContextWindow = maxContextWindow
      ? Math.min(requestedContextWindow, maxContextWindow)
      : requestedContextWindow;
    return {
      model: slug || null,
      modelDefaultContextWindow: Number.isSafeInteger(model?.context_window) ? model.context_window : null,
      modelMaxContextWindow: maxContextWindow,
      effectiveContextWindowPercent: effectivePercent,
      acceptedContextWindow,
      estimatedEffectiveContextWindow: Math.floor(acceptedContextWindow * effectivePercent / 100),
      clamped: acceptedContextWindow !== requestedContextWindow,
      catalogAvailable: Boolean(model)
    };
  }
}

export class ContextWindowStore {
  constructor({ filePath, now = () => new Date() }) {
    this.filePath = filePath;
    this.now = now;
    this.items = [];
    this.ready = false;
  }

  async init() {
    if (this.ready) return;
    try {
      const data = JSON.parse(await fs.readFile(this.filePath, "utf8"));
      this.items = Array.isArray(data.overrides) ? data.overrides.flatMap((item) => {
        try {
          return [{
            threadId: cleanThreadId(item.threadId),
            requestedContextWindow: validateContextWindow(item.requestedContextWindow),
            createdAt: item.createdAt || null,
            updatedAt: item.updatedAt || item.createdAt || null
          }];
        } catch {
          return [];
        }
      }) : [];
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      this.items = [];
    }
    this.ready = true;
    await this.save();
  }

  list() {
    return [...this.items].sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
  }

  get(threadId) {
    const normalized = cleanThreadId(threadId);
    return this.items.find((item) => item.threadId === normalized) || null;
  }

  async set(threadId, requestedContextWindow) {
    const normalized = cleanThreadId(threadId);
    const contextWindow = validateContextWindow(requestedContextWindow);
    const now = this.now().toISOString();
    let item = this.items.find((candidate) => candidate.threadId === normalized);
    if (item) {
      item.requestedContextWindow = contextWindow;
      item.updatedAt = now;
    } else {
      item = { threadId: normalized, requestedContextWindow: contextWindow, createdAt: now, updatedAt: now };
      this.items.push(item);
    }
    await this.save();
    return { ...item };
  }

  async remove(threadId) {
    const normalized = cleanThreadId(threadId);
    const index = this.items.findIndex((item) => item.threadId === normalized);
    if (index < 0) return false;
    this.items.splice(index, 1);
    await this.save();
    return true;
  }

  async save() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify({ version: 1, overrides: this.items }, null, 2), { mode: 0o600 });
    await fs.rename(temporaryPath, this.filePath);
  }
}

export async function describeContextOverride(item, task, modelCatalog) {
  const resolution = await modelCatalog.resolve(task?.model, item.requestedContextWindow);
  return {
    ...item,
    threadTitle: task?.title || `会话 ${item.threadId.slice(0, 8)}`,
    project: task?.project || null,
    taskAvailable: Boolean(task),
    observedContextWindow: task?.modelContextWindow || null,
    ...resolution
  };
}
