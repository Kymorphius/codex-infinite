import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

function quotedTomlPath(value) {
  return JSON.stringify(String(value));
}

function parseTomlString(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"')) {
    const match = trimmed.match(/^"(?:\\.|[^"\\])*"/);
    if (!match) return null;
    try { return JSON.parse(match[0]); } catch { return null; }
  }
  const match = trimmed.match(/^'([^']*)'/);
  return match?.[1] ?? null;
}

function skillConfigBlocks(source) {
  const lines = String(source || "").split(/(?<=\n)/);
  const starts = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (/^\s*\[\[\s*skills\.config\s*\]\]\s*(?:#.*)?(?:\r?\n)?$/.test(lines[index])) starts.push(index);
  }
  return starts.map((start, position) => {
    let end = lines.length;
    for (let index = start + 1; index < lines.length; index += 1) {
      if (/^\s*\[{1,2}[^\]]+\]{1,2}\s*(?:#.*)?(?:\r?\n)?$/.test(lines[index])) { end = index; break; }
    }
    const body = lines.slice(start, end).join("");
    const pathMatch = body.match(/^\s*path\s*=\s*(.+)$/m);
    const enabledMatch = body.match(/^\s*enabled\s*=\s*(true|false)\b/im);
    return { start, end, path: pathMatch ? parseTomlString(pathMatch[1]) : null, enabled: enabledMatch ? enabledMatch[1].toLowerCase() !== "false" : true, position };
  });
}

function normalizedPath(value, platform) {
  const resolved = (platform === "win32" ? path.win32 : path.posix).resolve(String(value));
  return platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function skillEnabledFromConfig(source, skillPath, platform = process.platform) {
  const wanted = normalizedPath(skillPath, platform);
  let enabled = true;
  for (const block of skillConfigBlocks(source)) {
    if (block.path && normalizedPath(block.path, platform) === wanted) enabled = block.enabled;
  }
  return enabled;
}

export function updateSkillConfig(source, skillPath, enabled, platform = process.platform) {
  const text = String(source || "");
  const lines = text.split(/(?<=\n)/);
  const wanted = normalizedPath(skillPath, platform);
  const removals = skillConfigBlocks(text).filter((block) => block.path && normalizedPath(block.path, platform) === wanted);
  for (const block of removals.sort((left, right) => right.start - left.start)) lines.splice(block.start, block.end - block.start);
  let result = lines.join("").replace(/\s*$/, "");
  const resolvedSkillPath = (platform === "win32" ? path.win32 : path.posix).resolve(skillPath);
  if (!enabled) result += `${result ? "\n\n" : ""}[[skills.config]]\npath = ${quotedTomlPath(resolvedSkillPath)}\nenabled = false`;
  return `${result}\n`;
}

async function readDocument(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return { exists: true, content: await fs.readFile(filePath, "utf8"), mode: stat.mode & 0o777 };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { exists: false, content: "", mode: 0o600 };
  }
}

async function atomicWrite(filePath, content, mode) {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.skill-toggle-${crypto.randomUUID()}`);
  try {
    await fs.writeFile(temporary, content, { mode, flag: "wx" });
    await fs.rename(temporary, filePath);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

export class SkillConfigStore {
  constructor({ filePaths = [], platform = process.platform } = {}) {
    this.filePaths = [...new Set(filePaths.map((value) => path.resolve(value)))];
    this.platform = platform;
  }

  async isEnabled(skillPath) {
    for (const filePath of this.filePaths) {
      const document = await readDocument(filePath);
      if (!skillEnabledFromConfig(document.content, skillPath, this.platform)) return false;
    }
    return true;
  }

  async setEnabled(skillPath, enabled) {
    const documents = await Promise.all(this.filePaths.map(async (filePath) => ({ filePath, ...await readDocument(filePath) })));
    const written = [];
    try {
      for (const document of documents) {
        await atomicWrite(document.filePath, updateSkillConfig(document.content, skillPath, enabled, this.platform), document.mode);
        written.push(document);
      }
    } catch (error) {
      for (const document of written.reverse()) {
        if (document.exists) await atomicWrite(document.filePath, document.content, document.mode).catch(() => {});
        else await fs.rm(document.filePath, { force: true }).catch(() => {});
      }
      throw error;
    }
    return { enabled: Boolean(enabled), restartRequired: true };
  }
}
