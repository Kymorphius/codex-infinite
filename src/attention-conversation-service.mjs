import path from "node:path";
import { projectAttentionConversations } from './attention-conversations.mjs';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class AttentionConversationService {
  constructor({ taskAdapter, unreadStateProvider, runtimeStatusProvider = null, draftReader = null, archivedSessionRoot = null, clock = Date.now, cacheMs = 5000 } = {}) {
    Object.assign(this, { taskAdapter, unreadStateProvider, runtimeStatusProvider, draftReader, archivedSessionRoot, clock, cacheMs });
    this.nextRefresh = 0; this.pending = null;
    this.snapshot = { items: [], stale: true };
  }
  async read() {
    if (!this.pending && this.clock() >= this.nextRefresh) {
      this.pending = this.refresh().finally(() => { this.nextRefresh = this.clock() + this.cacheMs; this.pending = null; });
    }
    await this.pending;
    return this.snapshot;
  }
  async refresh() {
    try {
      if (typeof this.unreadStateProvider?.readUnreadIds !== 'function') throw Error('unread state unavailable');
      const [result, unread, runtime, drafts] = await Promise.all([
        this.taskAdapter.listTasks(), this.unreadStateProvider.readUnreadIds(),
        this.runtimeStatusProvider?.readThreadStatuses({ strict: true }),
        // Drafts are decoration: an unreadable state file must not mark the snapshot stale.
        this.draftReader ? this.draftReader().catch(() => new Map()) : new Map()
      ]);
      if (!Array.isArray(result?.tasks) || ['error', 'disconnected'].includes(result.status)) throw Error('task snapshot unavailable');
      if (!Array.isArray(unread) || unread.some(id => typeof id !== 'string' || !ID.test(id))) throw Error('unread state unavailable');
      const tasks = result.tasks.map(task => ({ ...task,
        status: runtime?.get(task.id) || (runtime && task.status === 'active' ? 'unknown' : task.status)
      }));
      const eligible = tasks.filter(task => {
        if (!ID.test(task.id || '') || task.archived || task.isSubagent) return false;
        if (!this.archivedSessionRoot || !task.sourceFile) return true;
        const relative = path.relative(this.archivedSessionRoot, task.sourceFile);
        return relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative);
      });
      const unreadSet = new Set(unread.map(id => id.toLowerCase()));
      this.snapshot = { items: projectAttentionConversations(eligible, unread), stale: false,
        statuses: Object.fromEntries(eligible.map(task => [task.id.toLowerCase(), { status: task.status || 'unknown', unread: unreadSet.has(task.id.toLowerCase()), ...(task.quotaResetsAt ? { quotaResetsAt: task.quotaResetsAt } : {}),
          ...(drafts.has(task.id.toLowerCase()) ? { draft: drafts.get(task.id.toLowerCase()) } : {}) }])) };
    } catch { this.snapshot = { ...this.snapshot, stale: true }; }
  }
}
