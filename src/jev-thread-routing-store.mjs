import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_OVERRIDES = 5000;

export function normalizeJevThreadRoutingOverrides(value = {}) {
  const source = value?.overrides && typeof value.overrides === "object" && !Array.isArray(value.overrides) ? value.overrides : {};
  const overrides = {};
  for (const [rawThreadId, enabled] of Object.entries(source).slice(0, MAX_OVERRIDES)) {
    const threadId = String(rawThreadId).toLowerCase();
    if (THREAD_ID_PATTERN.test(threadId) && typeof enabled === "boolean") overrides[threadId] = enabled;
  }
  return { version: 1, overrides };
}

export class JevThreadRoutingStore {
  constructor({ filePath } = {}) { this.filePath = filePath; }

  async read() {
    try { return normalizeJevThreadRoutingOverrides(JSON.parse(await fs.readFile(this.filePath, "utf8"))); }
    catch (error) {
      if (error.code === "ENOENT" || error instanceof SyntaxError) return normalizeJevThreadRoutingOverrides();
      throw error;
    }
  }

  async write(value) {
    const state = normalizeJevThreadRoutingOverrides(value);
    await fs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
      await fs.rename(temporary, this.filePath);
    } finally {
      await fs.rm(temporary, { force: true });
    }
    return state;
  }

  async set(threadId, enabled) {
    const normalized = String(threadId || "").toLowerCase();
    if (!THREAD_ID_PATTERN.test(normalized) || typeof enabled !== "boolean") throw new Error("当前会话自动分流设置无效");
    const state = await this.read();
    return this.write({ ...state, overrides: { ...state.overrides, [normalized]: enabled } });
  }

  async clear() { return this.write({ version: 1, overrides: {} }); }
}
