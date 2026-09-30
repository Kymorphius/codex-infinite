import fs from 'node:fs/promises';
import path from 'node:path';

async function collectJsonlFiles(root, output, fsImpl, scan) {
  let entries;
  try { entries = await fsImpl.readdir(root, { withFileTypes: true }); }
  catch (error) {
    if (error.code === 'ENOENT') { scan.cacheable = false; return; }
    throw error;
  }
  for (const entry of entries) {
    const filePath = path.join(root, entry.name);
    if (entry.isDirectory()) await collectJsonlFiles(filePath, output, fsImpl, scan);
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) output.push(filePath);
  }
}

// Reuse only filesystem discovery metadata within one short UI refresh burst.
export class SessionFileScan {
  constructor({ sessionRoot, archivedSessionRoot, fsImpl = fs, clock = Date.now, ttlMs = 250 } = {}) {
    this.roots = [sessionRoot, archivedSessionRoot].filter(Boolean);
    this.fs = fsImpl;
    this.clock = clock;
    this.ttlMs = Math.min(500, Math.max(0, Number(ttlMs) || 0));
    this.cached = null;
    this.inflight = null;
  }

  async read() {
    const age = this.cached ? this.clock() - this.cached.at : -1;
    if (age >= 0 && age < this.ttlMs) return this.cached.rows.map(row => ({ ...row }));
    if (!this.inflight) this.inflight = this.readFresh().finally(() => { this.inflight = null; });
    return (await this.inflight).map(row => ({ ...row }));
  }

  async readFresh() {
    try {
      const files = [], scan = { cacheable: true };
      for (const root of this.roots) await collectJsonlFiles(root, files, this.fs, scan);
      const rows = await Promise.all(files.map(async filePath => ({ filePath, stat: await this.fs.stat(filePath) })));
      rows.sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs);
      this.cached = scan.cacheable ? { at: this.clock(), rows } : null;
      return rows;
    } catch (error) { this.invalidate(); throw error; }
  }

  invalidate() { this.cached = null; }
}
