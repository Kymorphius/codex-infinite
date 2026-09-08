import { readChecklistProjectIds } from './project-checklist-identity.mjs';
import { buildProjectSearchCatalog } from "./project-search.mjs";
import { readOriginalProjectDates } from "./new-project-metadata.mjs";
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { AppServerClient } from './app-server-client.mjs';
import { buildNativeProjectOrder, matchProjectForTask } from './project-order.mjs';
import { deriveNewProjects } from './new-project-policy.mjs';

export class NewProjectService {
  constructor({ codexPath, codexHome, taskAdapter, statePath, projectStatePaths = [], clock = Date.now, cacheMs = 60_000,
    clientFactory = () => new AppServerClient({ codexPath, codexHome }), logger = console } = {}) {
    Object.assign(this, { taskAdapter, statePath, projectStatePaths, clock, cacheMs, clientFactory, logger });
    this.nextRefresh = 0;
    this.snapshot = [];
    this.searchSnapshot = { projects: [], stale: true };
    this.pending = null;
  }

  async refresh(now) {
    let lifecycle = {};
    try {
      const stored = JSON.parse(await fs.readFile(this.statePath, 'utf8'));
      if (stored.version !== 1 || !stored.lifecycle || Array.isArray(stored.lifecycle) || typeof stored.lifecycle !== 'object') {
        throw new Error('invalid new-project lifecycle');
      }
      lifecycle = stored.lifecycle;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const originalDates = await readOriginalProjectDates(this.projectStatePaths);
    const checklistIds = await readChecklistProjectIds(this.projectStatePaths);
    const client = this.clientFactory();
    const projects = [];
    try {
      await client.initialize();
      let cursor = null;
      const seen = new Set();
      do {
        const page = await client.request('project/list', { cursor, limit: 100 });
        if (!Array.isArray(page?.data)) throw new Error('invalid project list');
        projects.push(...page.data.map((project) => ({ ...project,
          createdAt: originalDates.has(project.id)
            ? Math.min(originalDates.get(project.id), typeof project.createdAt === 'number' ? project.createdAt * 1000 : Infinity)
            : typeof project.createdAt === 'number' ? project.createdAt * 1000 : null
        })));
        cursor = page.nextCursor || null;
        if (cursor && seen.has(cursor)) throw new Error('repeated project cursor');
        if (cursor) seen.add(cursor);
      } while (cursor);
    } finally { client.close(); }
    const snapshot = await this.taskAdapter.listTasks();
    if (!Array.isArray(snapshot?.tasks)) throw new Error('invalid task snapshot');
    const ordered = buildNativeProjectOrder(projects, snapshot.tasks, new Date(now));
    const derived = deriveNewProjects(ordered, lifecycle, now);
    if (JSON.stringify(derived.lifecycle) !== JSON.stringify(lifecycle)) {
      await fs.mkdir(path.dirname(this.statePath), { recursive: true, mode: 0o700 });
      const temporary = `${this.statePath}.${crypto.randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, JSON.stringify({ version: 1, lifecycle: derived.lifecycle }), { mode: 0o600 });
        await fs.rename(temporary, this.statePath);
      } finally { await fs.rm(temporary, { force: true }); }
    }
    const tasksByProject = new Map(derived.projects.map((project) => [project.id, []]));
    for (const task of snapshot.tasks) {
      if (!/^[0-9a-f-]{36}$/i.test(task.id || '')) continue;
      const project = matchProjectForTask(projects, task);
      tasksByProject.get(project?.id)?.push({ id: task.id, title: String(task.title || '未命名任务').slice(0, 160) });
    }
    this.snapshot = derived.projects.map((project) => ({ ...project,
      name: String(project.name || '未命名项目').slice(0, 160), tasks: tasksByProject.get(project.id)
    }));
    this.searchSnapshot = { projects: buildProjectSearchCatalog(ordered, snapshot.tasks, task => matchProjectForTask(projects, task)).map(project => ({ ...project, checklistKey: checklistIds.get(project.id) || project.id })), stale: false };
    this.nextRefresh = this.clock() + this.cacheMs;
  }

  async readSearch() {
    await this.read();
    return this.searchSnapshot;
  }

  async read() {
    if (!this.pending && this.clock() >= this.nextRefresh) {
      this.pending = this.refresh(this.clock()).catch((error) => {
        this.searchSnapshot = { ...this.searchSnapshot, stale: true };
        this.nextRefresh = this.clock() + Math.min(this.cacheMs, 15_000);
        this.logger.warn(`[codex-control-console] new projects unavailable: ${error.message}`);
      }).finally(() => { this.pending = null; });
    }
    await this.pending;
    return this.snapshot.filter((project) => project.expiresAt > this.clock());
  }
}
