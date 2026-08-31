import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

const FILE_VERSION = 1;
const SERVER_ID_LIMIT = 256;
const KEY_LIMIT = 4096;

function validServerId(value) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= SERVER_ID_LIMIT;
}

function validKey(value) {
  return typeof value === "string" && value.length > 0 && value.length <= KEY_LIMIT;
}

function emptyDocument() {
  return { version: FILE_VERSION, keys: Object.create(null) };
}

function normalizeDocument(value) {
  if (!value || typeof value !== "object" || value.version !== FILE_VERSION || !value.keys || typeof value.keys !== "object") {
    return emptyDocument();
  }
  const document = emptyDocument();
  for (const [serverId, entry] of Object.entries(value.keys)) {
    if (validServerId(serverId) && validKey(entry?.key)) {
      document.keys[serverId] = { key: entry.key, savedAt: typeof entry.savedAt === "string" ? entry.savedAt : undefined };
    }
  }
  return document;
}

/**
 * Stores Local API keys only for the exact Zotero-Server-ID that issued them.
 * The remembered file is deliberately separate from served assets and is
 * replaced atomically with owner-only permissions. One-time keys stay in RAM.
 */
export class ZoteroCredentialStore {
  constructor({ filePath } = {}) {
    if (!filePath) throw new Error("Zotero credential file path is required");
    this.filePath = path.resolve(filePath);
    this.memory = new Map();
    this.writeQueue = Promise.resolve();
  }

  async _read() {
    try {
      const content = await fs.readFile(this.filePath, "utf8");
      return normalizeDocument(JSON.parse(content));
    } catch (error) {
      if (error?.code === "ENOENT" || error instanceof SyntaxError) return emptyDocument();
      return emptyDocument();
    }
  }

  async _atomicWrite(document) {
    const directory = path.dirname(this.filePath);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    try { await fs.chmod(directory, 0o700); } catch { /* The file permission remains the important boundary. */ }

    const temporaryPath = `${this.filePath}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
    let handle;
    try {
      handle = await fs.open(temporaryPath, "w", 0o600);
      await handle.writeFile(`${JSON.stringify(document)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await fs.chmod(temporaryPath, 0o600);
      await fs.rename(temporaryPath, this.filePath);
      await fs.chmod(this.filePath, 0o600);
    } catch (error) {
      try { await handle?.close(); } catch { /* Preserve the original error. */ }
      try { await fs.unlink(temporaryPath); } catch { /* The temporary file may not exist. */ }
      throw error;
    }
  }

  _enqueue(operation) {
    const result = this.writeQueue.then(operation, operation);
    this.writeQueue = result.catch(() => undefined);
    return result;
  }

  async get(serverId) {
    if (!validServerId(serverId)) return null;
    const inMemory = this.memory.get(serverId);
    if (inMemory) return { key: inMemory.key, remembered: false, oneTime: inMemory.oneTime };
    const document = await this._read();
    const entry = document.keys[serverId];
    return entry ? { key: entry.key, remembered: true, oneTime: false } : null;
  }

  async remember(serverId, key) {
    if (!validServerId(serverId) || !validKey(key)) throw new Error("Invalid Zotero credential");
    return this._enqueue(async () => {
      const document = await this._read();
      document.keys[serverId] = { key, savedAt: new Date().toISOString() };
      this.memory.delete(serverId);
      await this._atomicWrite(document);
      return { remembered: true, oneTime: false };
    });
  }

  async keepInMemory(serverId, key) {
    if (!validServerId(serverId) || !validKey(key)) throw new Error("Invalid Zotero credential");
    return this._enqueue(async () => {
      // Choosing a one-time key should not silently fall back to an older
      // remembered key after the one-time key is consumed.
      const document = await this._read();
      if (Object.hasOwn(document.keys, serverId)) {
        delete document.keys[serverId];
        await this._atomicWrite(document);
      }
      this.memory.set(serverId, { key, oneTime: true });
      return { remembered: false, oneTime: true };
    });
  }

  async save(serverId, key, { remember = false } = {}) {
    return remember ? this.remember(serverId, key) : this.keepInMemory(serverId, key);
  }

  async consumeOneTime(serverId) {
    if (!validServerId(serverId)) return false;
    return this._enqueue(async () => {
      const entry = this.memory.get(serverId);
      if (!entry?.oneTime) return false;
      this.memory.delete(serverId);
      return true;
    });
  }

  async forget(serverId) {
    if (!validServerId(serverId)) return false;
    return this._enqueue(async () => {
      this.memory.delete(serverId);
      const document = await this._read();
      if (!Object.hasOwn(document.keys, serverId)) return false;
      delete document.keys[serverId];
      await this._atomicWrite(document);
      return true;
    });
  }

  async forgetAllForServer(serverId) {
    return this.forget(serverId);
  }

  async forgetAll() {
    return this._enqueue(async () => {
      const hadMemory = this.memory.size > 0;
      this.memory.clear();
      const document = await this._read();
      const hadRemembered = Object.keys(document.keys).length > 0;
      if (hadRemembered) await this._atomicWrite(emptyDocument());
      return hadMemory || hadRemembered;
    });
  }

  async hasAnyRemembered() {
    const document = await this._read();
    return Object.keys(document.keys).length > 0;
  }

  async hasRememberedFile() {
    try {
      const stats = await fs.stat(this.filePath);
      return stats.isFile();
    } catch {
      return false;
    }
  }
}

export const CREDENTIAL_FILE_VERSION = FILE_VERSION;
