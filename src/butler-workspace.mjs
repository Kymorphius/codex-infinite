import defaultFs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildButlerOverview, renderButlerOverviewMarkdown } from './butler-overview.mjs';
import { buildButlerAgentsMd } from './butler-prompt.mjs';

const signature = overview => JSON.stringify({ ...overview, capturedAt: undefined });

export class ButlerWorkspace {
  constructor({ cwd, sessionRoots = [], archivedSessionRoot = '', read, intervalMs = 30000, heartbeatMs = 600000, fs = defaultFs, now = () => new Date(), log = message => console.warn(message) } = {}) {
    if (!cwd || !path.isAbsolute(cwd)) throw Error('butler cwd must be absolute');
    Object.assign(this, { cwd, sessionRoots, archivedSessionRoot, read, intervalMs, heartbeatMs, fs, now, log });
    this.timer = null; this.pending = null; this.written = null; this.writtenAt = 0; this.lastError = null; this.truncatedLogged = false;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.refresh(), this.intervalMs);
    this.timer.unref?.();
    void this.refresh();
  }

  stop() { clearInterval(this.timer); this.timer = null; }

  refresh() {
    this.pending ||= this.refreshNow().finally(() => { this.pending = null; });
    return this.pending;
  }

  async refreshNow() {
    try {
      await this.fs.mkdir(this.cwd, { recursive: true, mode: 0o700 });
      const agents = buildButlerAgentsMd({ cwd: this.cwd, sessionRoots: this.sessionRoots });
      const current = await this.fs.readFile(path.join(this.cwd, 'AGENTS.md'), 'utf8').catch(() => null);
      if (current !== agents) await this.writeAtomic('AGENTS.md', agents);
      const overview = buildButlerOverview({ ...await this.read(), butlerCwd: this.cwd, archivedSessionRoot: this.archivedSessionRoot, now: this.now() });
      if (overview.truncated && !this.truncatedLogged) { this.truncatedLogged = true; this.log(`[codex-control-console] butler overview truncated to ${overview.rows.length} of ${overview.total} rows`); }
      const next = signature(overview);
      // Unchanged content is still rewritten now and then so capturedAt keeps proving freshness.
      if (next !== this.written || Date.parse(overview.capturedAt) - this.writtenAt >= this.heartbeatMs) {
        await this.writeAtomic('overview.json', JSON.stringify(overview) + '\n');
        await this.writeAtomic('overview.md', renderButlerOverviewMarkdown(overview));
        this.written = next; this.writtenAt = Date.parse(overview.capturedAt);
      }
      this.lastError = null;
      return overview;
    } catch (error) {
      if (error.message !== this.lastError) { this.lastError = error.message; this.log(`[codex-control-console] butler workspace refresh failed: ${error.message}`); }
      return null;
    }
  }

  async writeAtomic(name, content) {
    const target = path.join(this.cwd, name), temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await this.fs.writeFile(temporary, content, { mode: 0o600 });
      await this.fs.rename(temporary, target);
    } catch (error) {
      await this.fs.rm?.(temporary, { force: true }).catch(() => {});
      throw error;
    }
  }
}
