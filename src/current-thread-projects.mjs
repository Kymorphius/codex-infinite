import path from "node:path";

const MAX_THREADS = 800;
const MAX_PROJECTS = 512;

function bounded(value, maxLength) {
  const result = typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim() : "";
  return result ? result.slice(0, maxLength) : null;
}

function pathApi(value) {
  return /^[A-Za-z]:[\\/]/.test(String(value || "").replace(/^\\\\\?\\/, "")) ? path.win32 : path.posix;
}

function normalizedPath(value) {
  const clean = String(value || "").replace(/^\\\\\?\\/, "");
  const api = pathApi(clean);
  const normalized = api.normalize(clean);
  return { api, value: api === path.win32 ? normalized.toLocaleLowerCase("en-US") : normalized };
}

function contains(root, cwd) {
  const left = normalizedPath(root);
  const right = normalizedPath(cwd);
  if (left.api !== right.api) return false;
  const relative = left.api.relative(left.value, right.value);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${left.api.sep}`) && !left.api.isAbsolute(relative));
}

function normalizedProject(row = {}) {
  const id = bounded(row.id, 160);
  const name = bounded(row.name, 160);
  const root = bounded(row.path, 1024);
  return id && name && root ? { id, name, root } : null;
}

function worktreeProject(roots, cwd) {
  const match = String(cwd || "").replaceAll("\\", "/").match(/(?:^|\/)\.codex\/worktrees\/[^/]+\/([^/]+)/i);
  if (!match) return null;
  const candidates = roots.filter((project) => pathApi(project.root).basename(project.root).toLocaleLowerCase("en-US") === match[1].toLocaleLowerCase("en-US"));
  const paths = new Set(candidates.map((project) => normalizedPath(project.root).value));
  return paths.size === 1 ? candidates[0] : null;
}

export function createCurrentThreadProjectLookup({ threads = [], projects = [] } = {}) {
  const roots = projects.map(normalizedProject).filter(Boolean);
  const rootCounts = new Map();
  for (const project of roots) { const key = normalizedPath(project.root).value; rootCounts.set(key, (rootCounts.get(key) || 0) + 1); }
  const projectsById = new Map(roots.map((project) => [project.id, project]));
  const current = new Map();
  for (const row of threads.slice(0, MAX_THREADS)) {
    const id = bounded(row?.id, 160);
    const cwd = bounded(row?.cwd, 1024);
    if (!id) continue;
    const explicit = projectsById.get(bounded(row?.projectId ?? row?.project_id, 160));
    const matched = explicit || (cwd ? roots.filter((project) => contains(project.root, cwd)).sort((left, right) => right.root.length - left.root.length)[0] || worktreeProject(roots, cwd) : null);
    const ambiguousRoot = !explicit && matched && rootCounts.get(normalizedPath(matched.root).value) > 1;
    current.set(id, Object.freeze({ cwd, projectId: matched?.id || null, projectName: ambiguousRoot ? pathApi(matched.root).basename(matched.root) : matched?.name || null }));
  }
  const entries = Object.freeze([...current].map(([threadId, value]) => Object.freeze({ threadId, ...value })));
  return Object.freeze({
    currentFor(threadId) { return current.get(String(threadId || "")) || null; },
    entries() { return entries; }
  });
}

const EMPTY_LOOKUP = createCurrentThreadProjectLookup();

export class CurrentThreadProjectIndex {
  constructor({ databasePath, logger = console, databaseFactory } = {}) {
    this.databasePath = databasePath;
    this.logger = logger;
    this.databaseFactory = databaseFactory;
    this.warned = false;
  }

  async open() {
    if (this.databaseFactory) return this.databaseFactory(this.databasePath);
    const { DatabaseSync } = await import("node:sqlite");
    return new DatabaseSync(this.databasePath, { readOnly: true });
  }

  async read(threadIds = []) {
    const ids = [...new Set(threadIds.map((id) => bounded(id, 160)).filter(Boolean))].slice(0, MAX_THREADS);
    if (!this.databasePath || !ids.length) return EMPTY_LOOKUP;
    return this.readDatabase(ids);
  }

  async readAll() {
    if (!this.databasePath) return EMPTY_LOOKUP;
    return this.readDatabase(null);
  }

  async readDatabase(ids) {
    let database;
    try {
      database = await this.open();
      const threads = ids
        ? database.prepare(`SELECT id, cwd, project_id AS projectId FROM threads WHERE id IN (${ids.map(() => "?").join(",")})`).all(...ids)
        : database.prepare("SELECT id, cwd, project_id AS projectId FROM threads ORDER BY updated_at DESC LIMIT ?").all(MAX_THREADS);
      const projects = database.prepare("SELECT p.id, p.name, r.path FROM projects p JOIN project_roots r ON r.project_id = p.id ORDER BY p.position, r.position LIMIT ?").all(MAX_PROJECTS);
      this.warned = false;
      return createCurrentThreadProjectLookup({ threads, projects });
    } catch (error) {
      if (!this.warned) this.logger.warn(`[codex-control-console] current thread projects unavailable; using rollout metadata: ${error.message}`);
      this.warned = true;
      return EMPTY_LOOKUP;
    } finally {
      try { database?.close(); } catch {}
    }
  }
}
