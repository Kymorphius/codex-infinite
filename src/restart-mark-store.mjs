import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeRestartMarkState } from './restart-mark-contract.mjs';

export class RestartMarkStore {
  constructor({ filePath } = {}) { this.filePath = filePath; }

  async read() {
    try { return normalizeRestartMarkState(JSON.parse(await fs.readFile(this.filePath, 'utf8'))); }
    catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) return normalizeRestartMarkState();
      throw error;
    }
  }

  async write(value) {
    const state = normalizeRestartMarkState(value);
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
}
