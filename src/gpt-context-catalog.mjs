import fs from 'node:fs/promises';
import path from 'node:path';
import { createCurrentThreadProjectLookup } from './current-thread-projects.mjs';
import { SessionTitleIndex } from './session-title-index.mjs';

const MAX_THREADS = 10_000;
const ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const within = (root, file) => file.startsWith(root + path.sep);
const iso = (milliseconds, seconds) => {
  const value = Number(milliseconds) || Number(seconds) * 1000;
  return Number.isFinite(value) && value > 0 ? new Date(value).toISOString() : null;
};

export class GptContextCatalog {
  constructor({ databasePath, sessionRoots, titleIndexPath, device, databaseFactory } = {}) {
    this.databasePath = databasePath;
    this.sessionRoots = sessionRoots || [];
    this.titles = new SessionTitleIndex({ filePath: titleIndexPath });
    this.device = device;
    this.databaseFactory = databaseFactory;
  }

  async open() {
    if (this.databaseFactory) return this.databaseFactory();
    const { DatabaseSync } = await import('node:sqlite');
    return new DatabaseSync(this.databasePath, { readOnly: true });
  }

  async snapshot() {
    const titles = await this.titles.read();
    let db;
    try {
      db = await this.open();
      db.exec('BEGIN');
      const projects = db.prepare('SELECT id, name, position FROM projects ORDER BY position, id').all();
      const roots = db.prepare('SELECT project_id, path FROM project_roots ORDER BY position').all();
      const columns = new Set(db.prepare('PRAGMA table_info(threads)').all().map(row => row.name));
      const optional = name => columns.has(name) ? name : `NULL AS ${name}`;
      const rows = db.prepare(`SELECT id, title, cwd, rollout_path, project_id, source, archived,
        created_at, updated_at, ${optional('created_at_ms')}, ${optional('updated_at_ms')}
        FROM threads ORDER BY updated_at DESC, id LIMIT ?`).all(MAX_THREADS + 1);
      db.exec('COMMIT');
      const projectRoots = roots.map(root => ({ ...projects.find(p => p.id === root.project_id), path: root.path }));
      const membership = new Map();
      for (let offset = 0; offset < rows.length; offset += 800) {
        const lookup = createCurrentThreadProjectLookup({ threads: rows.slice(offset, offset + 800), projects: projectRoots });
        for (const value of lookup.entries()) membership.set(value.threadId, value);
      }
      return {
        capturedAt: new Date().toISOString(), truncated: rows.length > MAX_THREADS,
        projects: projects.map(project => ({ id: project.id, name: String(project.name || '未命名项目').slice(0, 300),
          directories: roots.filter(root => root.project_id === project.id).map(root => String(root.path).slice(0, 2048)) })),
        conversations: rows.slice(0, MAX_THREADS).map(row => ({
          id: row.id, title: (titles.get(row.id) || row.title || '未命名会话').slice(0, 300),
          projectId: membership.get(row.id)?.projectId || null,
          projectMembership: row.project_id ? 'native' : membership.get(row.id)?.projectId ? 'directory-inferred' : 'unassigned',
          cwd: row.cwd ? String(row.cwd).slice(0, 2048) : null, archived: Boolean(row.archived),
          internal: /subagent/.test(row.source || ''),
          createdAt: iso(row.created_at_ms, row.created_at), updatedAt: iso(row.updated_at_ms, row.updated_at),
          transcriptPath: row.rollout_path || null
        }))
      };
    } catch {
      throw new Error('无法读取本机 GPT 项目和会话目录；请检查配置的原生数据目录。');
    } finally { try { db?.close(); } catch {} }
  }

  async transcriptPath(conversation) {
    if (!ID.test(conversation?.id || '') || !conversation.transcriptPath?.endsWith('.jsonl')) {
      throw new Error('这个会话没有可读取的本地历史。');
    }
    let file;
    try { file = await fs.realpath(conversation.transcriptPath); }
    catch { throw new Error('这个会话的本地历史文件暂时不可用。'); }
    for (const root of this.sessionRoots) {
      let resolved;
      try { resolved = await fs.realpath(root); } catch { continue; }
      if (within(resolved, file)) return file;
    }
    throw new Error('会话历史不在已配置的原生会话目录内，未读取。');
  }
}
