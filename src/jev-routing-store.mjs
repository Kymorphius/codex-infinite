import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { defaultJevRoutingConfig, normalizeJevRoutingConfig } from "./jev-routing-policy.mjs";

export class JevRoutingStore {
  constructor({ filePath } = {}) {
    this.filePath = filePath;
  }

  async read() {
    try {
      return normalizeJevRoutingConfig(JSON.parse(await fs.readFile(this.filePath, "utf8")));
    } catch (error) {
      if (error.code === "ENOENT") return defaultJevRoutingConfig();
      if (error instanceof SyntaxError) return defaultJevRoutingConfig();
      throw error;
    }
  }

  async write(value) {
    const config = normalizeJevRoutingConfig(value);
    await fs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(config, null, 2), { mode: 0o600 });
      await fs.rename(temporary, this.filePath);
    } finally {
      await fs.rm(temporary, { force: true });
    }
    return config;
  }
}
