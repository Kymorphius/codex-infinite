import path from "node:path";
import fs from 'node:fs/promises';
import { projectAttentionConversations } from './attention-conversations.mjs';

export class AttentionConversationService {
  constructor({ taskAdapter, statePath, additionalStatePaths = [], runtimeStatusProvider = null, archivedSessionRoot = null, clock = Date.now, cacheMs = 5000 } = {}) {
    Object.assign(this, { taskAdapter, statePath, runtimeStatusProvider, archivedSessionRoot, clock, cacheMs });
    this.statePaths = [...new Set([statePath, ...additionalStatePaths])];
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
      const [result, texts, runtime] = await Promise.all([
        this.taskAdapter.listTasks(), Promise.all(this.statePaths.map(file => fs.readFile(file, 'utf8').catch(error => {
          if (file !== this.statePath && error.code === 'ENOENT') return '{}';
          throw error;
        }))), this.runtimeStatusProvider?.readThreadStatuses({ strict: true })
      ]);
      if (!Array.isArray(result?.tasks) || ['error', 'disconnected'].includes(result.status)) throw Error('task snapshot unavailable');
      const unread = texts.flatMap(text => {
        const state = JSON.parse(text);
        const ids = state?.['electron-persisted-atom-state']?.['unread-thread-ids-by-host-v1']?.local ?? [];
        if (!Array.isArray(ids)) throw Error('unread state unavailable');
        return ids;
      });
      const tasks = result.tasks.map(task => ({ ...task,
        status: runtime?.get(task.id) || (runtime && task.status === 'active' ? 'unknown' : task.status)
      }));
      this.snapshot = { items: projectAttentionConversations(tasks.filter(task => {
        if (!this.archivedSessionRoot || !task.sourceFile) return true;
        const relative = path.relative(this.archivedSessionRoot, task.sourceFile);
        return relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative);
      }), unread), stale: false };
    } catch { this.snapshot = { ...this.snapshot, stale: true }; }
  }
}
