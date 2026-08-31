import fs from "node:fs/promises";
import path from "node:path";
import { normalizeThreadSettings } from "./thread-settings.mjs";

const DEFAULT_CHUNK_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_RECORD_BYTES = 1024 * 1024;
const SETTINGS_MARKER = Buffer.from('"thread_settings_applied"', "utf8");

function safeEntry(input) {
  if (!input || typeof input !== "object") return null;
  const sourceFile = typeof input.sourceFile === "string" ? input.sourceFile : "";
  const inode = Number(input.inode);
  const scannedBytes = Number(input.scannedBytes);
  if (!path.isAbsolute(sourceFile) || !Number.isSafeInteger(inode) || inode < 0 || !Number.isSafeInteger(scannedBytes) || scannedBytes < 0) return null;
  return {
    sourceFile,
    inode,
    scannedBytes,
    settings: input.settings && typeof input.settings === "object" ? normalizeThreadSettings(input.settings) : null
  };
}

export function threadSettingsFromRecord(record) {
  if (record?.type !== "event_msg" || record?.payload?.type !== "thread_settings_applied") return null;
  return normalizeThreadSettings(record.payload.thread_settings);
}

export function latestThreadSettingsFromJsonl(content) {
  let latest = null;
  for (const line of String(content || "").split(/\r?\n/)) {
    if (!line.includes("thread_settings_applied")) continue;
    try { latest = threadSettingsFromRecord(JSON.parse(line)) || latest; } catch {}
  }
  return latest;
}

function settingsFromLine(line) {
  if (!line.includes(SETTINGS_MARKER)) return null;
  try { return threadSettingsFromRecord(JSON.parse(line.toString("utf8").replace(/\r$/, ""))); } catch { return null; }
}

async function scanAppendedSettings(handle, start, end, current, { chunkBytes, maxRecordBytes }) {
  let position = start;
  let completeOffset = start;
  let lineParts = [];
  let lineBytes = 0;
  let overflow = false;
  let settings = current;

  while (position < end) {
    const requested = Math.min(chunkBytes, end - position);
    const chunk = Buffer.allocUnsafe(requested);
    const { bytesRead } = await handle.read(chunk, 0, requested, position);
    if (!bytesRead) break;
    const data = chunk.subarray(0, bytesRead);
    let cursor = 0;
    while (cursor < data.length) {
      const newline = data.indexOf(0x0a, cursor);
      const boundary = newline < 0 ? data.length : newline;
      const segment = data.subarray(cursor, boundary);
      if (!overflow) {
        if (lineBytes + segment.length <= maxRecordBytes) {
          if (segment.length) lineParts.push(segment);
          lineBytes += segment.length;
        } else {
          overflow = true;
          lineParts = [];
          lineBytes = 0;
        }
      }
      if (newline < 0) break;
      if (!overflow && lineBytes) settings = settingsFromLine(Buffer.concat(lineParts, lineBytes)) || settings;
      completeOffset = position + newline + 1;
      lineParts = [];
      lineBytes = 0;
      overflow = false;
      cursor = newline + 1;
    }
    position += bytesRead;
  }

  return { settings, scannedBytes: completeOffset };
}

export class SessionSettingsIndex {
  constructor({ filePath, chunkBytes = DEFAULT_CHUNK_BYTES, maxRecordBytes = DEFAULT_MAX_RECORD_BYTES } = {}) {
    this.filePath = filePath;
    this.chunkBytes = chunkBytes;
    this.maxRecordBytes = maxRecordBytes;
    this.entries = new Map();
    this.inflight = new Map();
    this.ready = false;
  }

  async init() {
    if (this.ready) return;
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, "utf8"));
      for (const raw of Array.isArray(parsed.entries) ? parsed.entries.slice(0, 500) : []) {
        const entry = safeEntry(raw);
        if (entry) this.entries.set(entry.sourceFile, entry);
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    this.ready = true;
  }

  async save() {
    if (!this.filePath) return;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify({ version: 1, entries: [...this.entries.values()] }, null, 2), { mode: 0o600 });
    await fs.rename(temporaryPath, this.filePath);
  }

  async read(sourceFile) {
    await this.init();
    const normalized = path.resolve(sourceFile);
    if (this.inflight.has(normalized)) return this.inflight.get(normalized);
    const operation = this.readOnce(normalized).finally(() => this.inflight.delete(normalized));
    this.inflight.set(normalized, operation);
    return operation;
  }

  async readOnce(sourceFile) {
    const stat = await fs.stat(sourceFile);
    let entry = this.entries.get(sourceFile);
    if (!entry || entry.inode !== stat.ino || entry.scannedBytes > stat.size) {
      entry = { sourceFile, inode: stat.ino, scannedBytes: 0, settings: null };
    }
    if (entry.scannedBytes >= stat.size) return entry.settings;
    const handle = await fs.open(sourceFile, "r");
    try {
      const scanned = await scanAppendedSettings(handle, entry.scannedBytes, stat.size, entry.settings, {
        chunkBytes: this.chunkBytes,
        maxRecordBytes: this.maxRecordBytes
      });
      entry = { ...entry, ...scanned };
    } finally {
      await handle.close();
    }
    this.entries.set(sourceFile, entry);
    await this.save();
    return entry.settings;
  }
}
