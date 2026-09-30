import fs from "node:fs/promises";
import { boundedSessionTitle } from "./session-title.mjs";

export function parseSessionTitleIndex(content) {
  const titles = new Map();
  for (const line of String(content).split(/\r?\n/)) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const id = typeof record?.id === "string" ? record.id.trim() : "";
    const title = typeof record?.thread_name === "string" ? record.thread_name.trim() : "";
    if (id && title) titles.set(id, boundedSessionTitle(title, ""));
  }
  return titles;
}

export class SessionTitleIndex {
  constructor({ filePath, fsImpl = fs } = {}) {
    this.filePath = filePath;
    this.fs = fsImpl;
    this.cached = null;
    this.inflight = null;
  }

  async read() {
    return new Map(await this.readShared());
  }

  readShared() {
    if (!this.inflight) this.inflight = this.readFresh().finally(() => { this.inflight = null; });
    return this.inflight;
  }

  async readFresh() {
    if (!this.filePath) return new Map();
    try {
      const stat = await this.fs.stat(this.filePath);
      const signature = `${stat.dev}:${stat.ino}:${stat.ctimeMs}:${stat.mtimeMs}:${stat.size}`;
      if (this.cached?.signature === signature) return this.cached.titles;
      const titles = parseSessionTitleIndex(await this.fs.readFile(this.filePath, "utf8"));
      this.cached = { signature, titles };
      return titles;
    } catch {
      this.cached = null;
      return new Map();
    }
  }

  async titleOf(threadId) {
    const titles = await this.readShared();
    return titles.get(String(threadId || '').toLowerCase()) || titles.get(String(threadId || '')) || '';
  }
}

// Title of one Codex conversation, re-reading the index only when it changes.
export function createCodexTitleLookup(options = {}) {
  const index = new SessionTitleIndex(options);
  return threadId => index.titleOf(threadId);
}
