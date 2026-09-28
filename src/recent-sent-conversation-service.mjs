import path from 'node:path';
import { SessionUserMessageIndex } from './session-user-message-index.mjs';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function archived(sourceFile, root) {
  if (!root) return false;
  const relative = path.relative(root, sourceFile);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

/** Projects the existing task cache without directory scans or blocking injection. */
export class RecentSentConversationService {
  constructor({ taskAdapter, archivedSessionRoot = null, index = new SessionUserMessageIndex(), clock = Date.now, cacheMs = 5000, limit = 40 } = {}) {
    Object.assign(this, { taskAdapter, archivedSessionRoot, index, clock, cacheMs });
    this.limit = Math.max(1, Math.min(40, Number(limit) || 40));
    this.snapshot = { items: [], loading: true, stale: false };
    this.nextRefresh = 0;
    this.pending = null;
  }

  read() {
    if (!this.pending && this.clock() >= this.nextRefresh) {
      this.pending = this.refresh().catch(() => {
        this.snapshot = { ...this.snapshot, loading: false, stale: true };
      }).finally(() => {
        this.nextRefresh = this.clock() + this.cacheMs;
        this.pending = null;
      });
    }
    return { ...this.snapshot, items: this.snapshot.items.map(item => ({ ...item })) };
  }

  async refresh() {
    if (typeof this.taskAdapter?.getCachedTasks !== 'function') throw new Error('Task cache unavailable');
    const cached = this.taskAdapter.getCachedTasks();
    if (cached === null) {
      this.snapshot = { ...this.snapshot, loading: true };
      return;
    }
    if (!Array.isArray(cached)) throw new Error('Task cache unavailable');
    const tasks = cached.filter(task => UUID.test(task?.id || '') && task.sourceFile && !task.isSubagent && !task.archived && !archived(task.sourceFile, this.archivedSessionRoot));
    const previous = new Map(this.snapshot.items.map(item => [item.id, item]));
    const items = new Map();
    let cursor = 0;
    let stale = false;
    const worker = async () => {
      while (cursor < tasks.length) {
        const task = tasks[cursor++];
        const id = task.id.toLowerCase();
        try {
          const result = await this.index.read(task.sourceFile);
          if (!result.complete) stale = true;
          if (!result.lastUserMessageAt) { if (!result.complete) throw new Error('No verified timestamp'); continue; }
          const timestamp = Date.parse(result.lastUserMessageAt);
          if (!Number.isFinite(timestamp)) throw new Error('Invalid message timestamp');
          const item = { kind: 'local', id, title: String(task.title || `会话 ${id.slice(0, 8)}`).slice(0, 160), lastUserMessageAt: new Date(timestamp).toISOString(), status: task.status || 'unknown', ...(task.quotaResetsAt ? { quotaResetsAt: task.quotaResetsAt } : {}) };
          if (!result.complete && previous.get(id)?.lastUserMessageAt > item.lastUserMessageAt) item.lastUserMessageAt = previous.get(id).lastUserMessageAt;
          if (!items.has(id) || item.lastUserMessageAt > items.get(id).lastUserMessageAt) items.set(id, item);
        } catch {
          stale = true;
          if (!items.has(id) && previous.has(id)) items.set(id, previous.get(id));
        }
      }
    };
    await Promise.all([worker(), worker()]);
    this.index.retain?.(tasks.map(task => task.sourceFile));
    this.snapshot = {
      items: [...items.values()].sort((a, b) => b.lastUserMessageAt.localeCompare(a.lastUserMessageAt) || a.id.localeCompare(b.id)).slice(0, this.limit),
      loading: false, stale
    };
  }
}
