import fs from "node:fs/promises";
import path from "node:path";

function boundedName(value) {
  const name = typeof value === "string" ? value.trim() : "";
  return name ? name.slice(0, 160) : null;
}

function pathApi(value) {
  return /^[A-Za-z]:[\\/]/.test(String(value || "")) ? path.win32 : path.posix;
}

function normalized(value) {
  const api = pathApi(value);
  const result = api.normalize(String(value || "").trim());
  return { api, value: api === path.win32 ? result.toLowerCase() : result };
}

function contains(root, cwd) {
  const normalizedRoot = normalized(root);
  const normalizedCwd = normalized(cwd);
  if (normalizedRoot.api !== normalizedCwd.api) return false;
  const relative = normalizedRoot.api.relative(normalizedRoot.value, normalizedCwd.value);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${normalizedRoot.api.sep}`) && !normalizedRoot.api.isAbsolute(relative));
}

function worktreeCheckoutName(cwd) {
  const match = String(cwd || "").replaceAll("\\", "/").match(/(?:^|\/)\.codex\/worktrees\/[^/]+\/([^/]+)/i);
  return match?.[1] || null;
}

function projectEntries(state) {
  const projects = state?.["local-projects"];
  if (!projects || typeof projects !== "object" || Array.isArray(projects)) return [];
  return Object.values(projects).flatMap((project) => {
    const name = boundedName(project?.name);
    const roots = Array.isArray(project?.rootPaths) ? project.rootPaths.filter((root) => typeof root === "string" && root.trim()) : [];
    return name && roots.length ? [{ name, roots }] : [];
  });
}

export function createCurrentProjectNameLookup(state = {}) {
  const projects = projectEntries(state);
  const worktreeNames = new Map();
  for (const project of projects) {
    for (const root of project.roots) {
      const key = pathApi(root).basename(root).toLocaleLowerCase("en-US");
      if (!worktreeNames.has(key)) worktreeNames.set(key, new Set());
      worktreeNames.get(key).add(project.name);
    }
  }
  return Object.freeze({
    nameFor(cwd) {
      if (typeof cwd !== "string" || !cwd.trim()) return null;
      const direct = projects.flatMap((project) => project.roots.map((root) => ({ ...project, root })))
        .filter((project) => contains(project.root, cwd))
        .sort((left, right) => normalized(right.root).value.length - normalized(left.root).value.length)[0];
      if (direct) return direct.name;
      const checkout = worktreeCheckoutName(cwd);
      if (!checkout) return null;
      const names = worktreeNames.get(checkout.toLocaleLowerCase("en-US"));
      return names?.size === 1 ? [...names][0] : null;
    }
  });
}

const EMPTY_LOOKUP = createCurrentProjectNameLookup();

export class CurrentProjectNameIndex {
  constructor({ filePath, logger = console } = {}) {
    this.filePath = filePath;
    this.logger = logger;
    this.warned = false;
  }

  async read() {
    if (!this.filePath) return EMPTY_LOOKUP;
    try {
      const state = JSON.parse(await fs.readFile(this.filePath, "utf8"));
      this.warned = false;
      return createCurrentProjectNameLookup(state);
    } catch (error) {
      if (error?.code !== "ENOENT" && !this.warned) {
        this.logger.warn("[codex-control-console] current project names unavailable; using directory names");
        this.warned = true;
      }
      return EMPTY_LOOKUP;
    }
  }
}
