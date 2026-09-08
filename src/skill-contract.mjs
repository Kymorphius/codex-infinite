import crypto from "node:crypto";

export const SKILL_SCHEMA_VERSION = 2;
export const SKILL_SCOPES = Object.freeze(["codex-user", "agents-user", "repo"]);
export const INSTALLABLE_SKILL_SCOPES = Object.freeze(["codex-user", "agents-user"]);
export const MAX_SKILL_FILES = 128;
export const MAX_SKILL_BYTES = 2 * 1024 * 1024;
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const SOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;

export function normalizeSkillName(value) {
  const name = String(value || "");
  if (!NAME_PATTERN.test(name)) throw new Error("Skill 目录名无效");
  return name;
}

export function normalizeSkillScope(value) {
  if (!SKILL_SCOPES.includes(value)) throw new Error("Skill 范围无效");
  return value;
}

export function normalizeSkillSourceId(value) {
  const sourceId = String(value || "");
  if (!SOURCE_ID_PATTERN.test(sourceId)) throw new Error("Skill 来源标识无效");
  return sourceId;
}

export function normalizeSkillLocator(input = {}) {
  return Object.freeze({
    scope: normalizeSkillScope(input.scope),
    sourceId: normalizeSkillSourceId(input.sourceId || input.scope),
    name: normalizeSkillName(input.name)
  });
}

export function normalizeSkillHash(value, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  const hash = String(value || "");
  if (!HASH_PATTERN.test(hash)) throw new Error("Skill 指纹无效");
  return hash;
}

export function normalizeSkillRelativePath(value) {
  const relativePath = String(value || "").replaceAll("\\", "/");
  const segments = relativePath.split("/");
  if (!relativePath || relativePath.startsWith("/") || segments.some((part) => !part || part === "." || part === "..") || relativePath.length > 240) {
    throw new Error("Skill 文件路径无效");
  }
  return relativePath;
}

export function skillPackageHash(files) {
  const hash = crypto.createHash("sha256");
  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
    hash.update(file.path, "utf8");
    hash.update("\0");
    hash.update(file.content);
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function normalizeSkillPackage(input = {}) {
  const scope = normalizeSkillScope(input.scope);
  if (!INSTALLABLE_SKILL_SCOPES.includes(scope)) throw new Error("Skill 安装范围无效");
  const name = normalizeSkillName(input.name);
  if (!Array.isArray(input.files) || !input.files.length || input.files.length > MAX_SKILL_FILES) throw new Error("Skill 文件数量无效");
  const seen = new Set();
  let totalBytes = 0;
  const files = input.files.map((file) => {
    const filePath = normalizeSkillRelativePath(file?.path);
    if (seen.has(filePath)) throw new Error("Skill 包含重复文件");
    seen.add(filePath);
    let content;
    if (Buffer.isBuffer(file?.content)) content = Buffer.from(file.content);
    else {
      if (typeof file?.content !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.content)) throw new Error("Skill 文件内容无效");
      content = Buffer.from(file.content, "base64");
      if (content.toString("base64") !== file.content) throw new Error("Skill 文件内容无效");
    }
    totalBytes += content.length;
    if (totalBytes > MAX_SKILL_BYTES) throw new Error("Skill 内容过大");
    return Object.freeze({ path: filePath, executable: file.executable === true, content });
  });
  if (!seen.has("SKILL.md")) throw new Error("Skill 缺少 SKILL.md");
  const hash = skillPackageHash(files);
  if (input.hash !== undefined && normalizeSkillHash(input.hash) !== hash) throw new Error("Skill 内容与指纹不一致");
  return Object.freeze({ schemaVersion: SKILL_SCHEMA_VERSION, scope, name, hash, totalBytes, files: Object.freeze(files) });
}

export function serializeSkillPackage(input) {
  const skill = normalizeSkillPackage(input);
  return {
    schemaVersion: SKILL_SCHEMA_VERSION,
    scope: skill.scope,
    name: skill.name,
    hash: skill.hash,
    totalBytes: skill.totalBytes,
    files: skill.files.map((file) => ({ path: file.path, executable: file.executable, content: file.content.toString("base64") }))
  };
}

export function normalizeSkillCatalog(input = {}) {
  if (input.schemaVersion !== SKILL_SCHEMA_VERSION || !Array.isArray(input.skills) || input.skills.length > 256) throw new Error("节点 Skill 清单无效");
  const skills = input.skills.map((skill) => ({
    scope: normalizeSkillScope(skill.scope),
    sourceId: normalizeSkillSourceId(skill.sourceId || skill.scope),
    name: normalizeSkillName(skill.name),
    declaredName: String(skill.declaredName || "").slice(0, 120),
    description: String(skill.description || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 500),
    hash: normalizeSkillHash(skill.hash),
    fileCount: Number.isInteger(skill.fileCount) && skill.fileCount >= 1 && skill.fileCount <= MAX_SKILL_FILES ? skill.fileCount : 0,
    totalBytes: Number.isInteger(skill.totalBytes) && skill.totalBytes >= 0 && skill.totalBytes <= MAX_SKILL_BYTES ? skill.totalBytes : 0,
    linked: skill.linked === true,
    enabled: skill.enabled !== false,
    projectName: skill.scope === "repo" ? String(skill.projectName || "项目").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 120) : null,
    updatedAt: typeof skill.updatedAt === "string" ? skill.updatedAt.slice(0, 40) : null
  }));
  return Object.freeze({ schemaVersion: SKILL_SCHEMA_VERSION, skills: Object.freeze(skills) });
}
