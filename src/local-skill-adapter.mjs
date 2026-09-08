import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { MAX_SKILL_BYTES, MAX_SKILL_FILES, SKILL_SCHEMA_VERSION, normalizeSkillHash, normalizeSkillLocator, normalizeSkillName, normalizeSkillPackage, normalizeSkillRelativePath, normalizeSkillScope, normalizeSkillSourceId, serializeSkillPackage, skillPackageHash } from "./skill-contract.mjs";

function frontmatter(source) {
  const block = String(source || "").match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!block) return { name: "", description: "" };
  const value = (key) => block[1].match(new RegExp(`^${key}:\\s*["']?([^\\r\\n"']+)["']?\\s*$`, "m"))?.[1]?.trim() || "";
  let description = value("description");
  if (/^[>|][-+]?$/u.test(description)) {
    const lines = block[1].split(/\r?\n/);
    const start = lines.findIndex((line) => /^description:\s*[>|][-+]?\s*$/.test(line));
    const continuation = [];
    for (const line of lines.slice(start + 1)) {
      if (line && !/^\s+/.test(line)) break;
      continuation.push(line.trim());
    }
    description = continuation.join(description.startsWith(">") ? " " : "\n").trim();
  }
  return { name: value("name").slice(0, 120), description: description.slice(0, 500) };
}

async function collectFiles(directory, relative = "", result = []) {
  const entries = await fs.readdir(path.join(directory, relative), { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const childRelative = normalizeSkillRelativePath(relative ? `${relative}/${entry.name}` : entry.name);
    const childPath = path.join(directory, childRelative);
    const stat = await fs.lstat(childPath);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new Error("Skill 包含不支持的链接或特殊文件");
    if (stat.isDirectory()) await collectFiles(directory, childRelative, result);
    else {
      if (result.length >= MAX_SKILL_FILES) throw new Error("Skill 文件数量过多");
      const content = await fs.readFile(childPath);
      const total = result.reduce((sum, file) => sum + file.content.length, 0) + content.length;
      if (total > MAX_SKILL_BYTES) throw new Error("Skill 内容过大");
      result.push({ path: childRelative, executable: (stat.mode & 0o111) !== 0, content });
    }
  }
  return result;
}

function rootFor(roots, scope, sourceId = scope) {
  const root = roots.find((entry) => entry.scope === normalizeSkillScope(scope) && entry.sourceId === normalizeSkillSourceId(sourceId));
  if (!root) throw new Error("Skill 范围未配置");
  return root;
}

function sourceIdFor(directory, platform) {
  const identity = platform === "win32" ? directory.toLowerCase() : directory;
  return `repo-${crypto.createHash("sha256").update(identity).digest("hex").slice(0, 20)}`;
}

async function repositorySkillDirectories(cwd) {
  const start = path.resolve(String(cwd || ""));
  if (!start) return [];
  const ancestors = [];
  let current = start;
  let repositoryRoot = null;
  while (true) {
    ancestors.push(current);
    try { await fs.lstat(path.join(current, ".git")); repositoryRoot = current; break; }
    catch (error) { if (error.code !== "ENOENT" && error.code !== "ENOTDIR") return []; }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const relevant = repositoryRoot ? ancestors.slice(0, ancestors.indexOf(repositoryRoot) + 1) : [start];
  return relevant.map((directory) => path.join(directory, ".agents", "skills"));
}

export class LocalSkillAdapter {
  constructor({ roots = [], node, projectRootsProvider, configStore, platform = process.platform } = {}) {
    this.roots = roots.map((entry) => ({ scope: normalizeSkillScope(entry.scope), sourceId: normalizeSkillSourceId(entry.sourceId || entry.scope), path: path.resolve(entry.path), projectName: null }));
    this.node = node;
    this.projectRootsProvider = projectRootsProvider;
    this.configStore = configStore;
    this.platform = platform;
  }

  async availableRoots() {
    const roots = [...this.roots];
    if (!this.projectRootsProvider) return roots;
    const tasks = await this.projectRootsProvider();
    const seen = new Set(roots.map((root) => this.platform === "win32" ? root.path.toLowerCase() : root.path));
    for (const task of tasks || []) {
      if (!task?.cwd) continue;
      for (const skillRoot of await repositorySkillDirectories(task.cwd)) {
        const resolved = path.resolve(skillRoot);
        const key = this.platform === "win32" ? resolved.toLowerCase() : resolved;
        if (seen.has(key)) continue;
        seen.add(key);
        roots.push({ scope: "repo", sourceId: sourceIdFor(resolved, this.platform), path: resolved, projectName: String(task.projectDisplayName || task.project || path.basename(task.cwd)).slice(0, 120) });
      }
    }
    return roots;
  }

  async readSkill(scope, name, sourceId = scope, roots = null) {
    name = normalizeSkillName(name);
    const root = rootFor(roots || await this.availableRoots(), scope, sourceId);
    const declaredDirectory = path.join(root.path, name);
    const declaredStat = await fs.lstat(declaredDirectory);
    const linked = declaredStat.isSymbolicLink();
    const directory = linked ? await fs.realpath(declaredDirectory) : declaredDirectory;
    const stat = linked ? await fs.stat(directory) : declaredStat;
    if (!stat.isDirectory()) throw new Error("Skill 目录不可导出");
    const files = await collectFiles(directory);
    if (!files.some((file) => file.path === "SKILL.md")) throw new Error("Skill 缺少 SKILL.md");
    const metadata = frontmatter(files.find((file) => file.path === "SKILL.md").content.toString("utf8"));
    const hash = skillPackageHash(files);
    const skillPath = path.join(declaredDirectory, "SKILL.md");
    const enabled = this.configStore ? await this.configStore.isEnabled(skillPath) : true;
    return { scope, sourceId: root.sourceId, projectName: root.projectName, name, directory, skillPath, files, hash, metadata, linked, enabled, totalBytes: files.reduce((sum, file) => sum + file.content.length, 0), updatedAt: stat.mtime.toISOString() };
  }

  async list() {
    const skills = [];
    const roots = await this.availableRoots();
    for (const root of roots) {
      let entries = [];
      try {
        const rootStat = await fs.lstat(root.path);
        if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) continue;
        entries = await fs.readdir(root.path, { withFileTypes: true });
      }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      for (const entry of entries) {
        if ((!entry.isDirectory() && !entry.isSymbolicLink()) || entry.name.startsWith(".")) continue;
        try {
          const skill = await this.readSkill(root.scope, entry.name, root.sourceId, roots);
          skills.push({ scope: root.scope, sourceId: root.sourceId, projectName: root.projectName, name: skill.name, declaredName: skill.metadata.name, description: skill.metadata.description, hash: skill.hash, fileCount: skill.files.length, totalBytes: skill.totalBytes, linked: skill.linked, enabled: skill.enabled, updatedAt: skill.updatedAt });
        } catch {
          // An invalid or linked directory is not advertised as shareable.
        }
      }
    }
    skills.sort((left, right) => (left.projectName || "").localeCompare(right.projectName || "") || left.name.localeCompare(right.name) || left.scope.localeCompare(right.scope));
    return { schemaVersion: SKILL_SCHEMA_VERSION, node: this.node, skills };
  }

  async export(scope, name, sourceId = scope) {
    const skill = await this.readSkill(scope, name, sourceId);
    const installScope = skill.scope === "repo" ? "agents-user" : skill.scope;
    return serializeSkillPackage({ ...skill, scope: installScope, files: skill.files.map((file) => ({ ...file, content: file.content.toString("base64") })) });
  }

  async setEnabled(input = {}) {
    if (!this.configStore) throw new Error("Skill 开关未配置");
    const locator = normalizeSkillLocator(input);
    const skill = await this.readSkill(locator.scope, locator.name, locator.sourceId);
    return this.configStore.setEnabled(skill.skillPath, input.enabled === true);
  }

  async install(input = {}) {
    const skill = normalizeSkillPackage(input.package);
    const expectedCurrentHash = normalizeSkillHash(input.expectedCurrentHash, { nullable: true });
    const root = rootFor(this.roots, skill.scope).path;
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    const rootStat = await fs.lstat(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("Skill 根目录不可写");
    const target = path.join(root, skill.name);
    let current = null;
    try { current = await this.readSkill(skill.scope, skill.name); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if ((current?.hash || null) !== expectedCurrentHash) {
      const conflict = new Error("目标 Skill 已在读取后发生变化，请刷新后重试");
      conflict.statusCode = 409;
      throw conflict;
    }
    if (current?.hash === skill.hash) return { accepted: true, unchanged: true, hash: skill.hash, backupCreated: false };
    if (current?.linked) {
      const conflict = new Error("目标 Skill 是目录链接，为避免破坏来源目录，不能自动替换");
      conflict.statusCode = 409;
      throw conflict;
    }

    const staging = path.join(root, `.${skill.name}.sync-${crypto.randomUUID()}`);
    await fs.mkdir(staging, { mode: 0o700 });
    let backup = null;
    try {
      for (const file of skill.files) {
        const destination = path.join(staging, file.path);
        await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
        await fs.writeFile(destination, file.content, { mode: file.executable ? 0o755 : 0o644, flag: "wx" });
      }
      const stagedFiles = await collectFiles(staging);
      if (skillPackageHash(stagedFiles) !== skill.hash) throw new Error("Skill 暂存校验失败");
      if (current) {
        const backupRoot = path.join(path.dirname(root), "skill-sync-backups", skill.scope);
        await fs.mkdir(backupRoot, { recursive: true, mode: 0o700 });
        backup = path.join(backupRoot, `${skill.name}-${Date.now()}-${current.hash.slice(0, 12)}`);
        await fs.rename(target, backup);
      }
      try { await fs.rename(staging, target); }
      catch (error) {
        if (backup) await fs.rename(backup, target).catch(() => {});
        throw error;
      }
      return { accepted: true, unchanged: false, hash: skill.hash, backupCreated: Boolean(backup) };
    } finally {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
    }
  }
}
