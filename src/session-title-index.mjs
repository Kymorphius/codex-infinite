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
  constructor({ filePath } = {}) {
    this.filePath = filePath;
  }

  async read() {
    if (!this.filePath) return new Map();
    try {
      return parseSessionTitleIndex(await fs.readFile(this.filePath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return new Map();
      return new Map();
    }
  }
}
