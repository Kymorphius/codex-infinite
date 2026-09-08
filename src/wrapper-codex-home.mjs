import fs from "node:fs/promises";
import path from "node:path";
import { repairWrapperProjectState } from "./wrapper-project-state.mjs";

export const SHARED_ENTRIES = Object.freeze([
  "auth.json",
  "installation_id",
  "sessions",
  "archived_sessions",
  "session_index.jsonl",
  "state_5.sqlite",
  "state_5.sqlite-shm",
  "state_5.sqlite-wal",
  "models_cache.json",
  "attachments",
  "skills",
  "plugins",
  "agents",
  "rules",
  "worktrees",
  "thread-writer-locks",
  "automations",
  "hooks.json"
]);

const REQUIRED_DANGLING_LINKS = new Set([
  "state_5.sqlite-shm",
  "state_5.sqlite-wal"
]);

function positiveInteger(value, label) {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value || ""), 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${label} 必须是正整数`);
  return parsed;
}

export function withoutWrapperContextConfig(source) {
  const lines = String(source || "").replace(/\s+$/, "").split(/\r?\n/);
  const tableIndex = lines.findIndex((line) => /^\s*\[/.test(line));
  const rootEnd = tableIndex < 0 ? lines.length : tableIndex;
  const contextKeys = /^(?:model_context_window|model_auto_compact_token_limit)\s*=/;
  const root = lines.slice(0, rootEnd).filter((line) => !contextKeys.test(line.trim()));
  const tables = lines.slice(rootEnd);
  return `${[...root, ...tables].join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+|\n+$/g, "")}\n`;
}

async function ensureSharedEntry(sourceHome, wrapperHome, name, platform, allowActiveRuntimeSidecars) {
  const sourcePath = path.join(sourceHome, name);
  const targetPath = path.join(wrapperHome, name);
  const allowDangling = REQUIRED_DANGLING_LINKS.has(name);
  try {
    await fs.lstat(sourcePath);
  } catch (error) {
    if (error.code === "ENOENT" && !allowDangling) return false;
    if (error.code === "ENOENT") {
      // SQLite creates and removes these sidecars dynamically. The wrapper link
      // must already exist so it can never materialize an unrelated local file.
    } else {
      throw error;
    }
  }
  try {
    const stat = await fs.lstat(targetPath);
    if (!stat.isSymbolicLink()) {
      if (platform === "win32" && allowActiveRuntimeSidecars && REQUIRED_DANGLING_LINKS.has(name)) return true;
      throw new Error(`包装版 CODEX_HOME 中的 ${name} 已存在且不是符号链接`);
    }
    const declaredTarget = await fs.readlink(targetPath);
    const currentTarget = path.resolve(path.dirname(targetPath), declaredTarget);
    const expectedTarget = path.resolve(sourcePath);
    const normalize = (value) => platform === "win32" ? value.toLowerCase() : value;
    if (normalize(currentTarget) !== normalize(expectedTarget)) throw new Error(`包装版 CODEX_HOME 中的 ${name} 指向了其他位置`);
    return true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let linkType;
  if (platform === "win32") {
    const sourceStat = await fs.stat(sourcePath).catch((error) => {
      if (error.code === "ENOENT" && allowDangling) return null;
      throw error;
    });
    linkType = sourceStat?.isDirectory() ? "junction" : "file";
  }
  await fs.symlink(sourcePath, targetPath, linkType);
  return true;
}

export async function prepareWrapperCodexHome({ sourceHome, wrapperHome, contextWindow, platform = process.platform, allowActiveRuntimeSidecars = false }) {
  if (!sourceHome || !wrapperHome) throw new Error("缺少 Codex 数据目录配置");
  if (path.resolve(sourceHome) === path.resolve(wrapperHome)) throw new Error("包装版 CODEX_HOME 不能与普通 Codex 共用同一配置目录");
  const requestedContextWindow = positiveInteger(contextWindow, "包装版上下文窗口");
  await fs.mkdir(wrapperHome, { recursive: true, mode: 0o700 });
  const sourceConfigPath = path.join(sourceHome, "config.toml");
  let sourceConfig = "";
  try {
    sourceConfig = await fs.readFile(sourceConfigPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const config = withoutWrapperContextConfig(sourceConfig);
  const configPath = path.join(wrapperHome, "config.toml");
  const temporaryPath = `${configPath}.tmp`;
  await fs.writeFile(temporaryPath, config, { mode: 0o600 });
  await fs.rename(temporaryPath, configPath);
  const sharedEntries = [];
  for (const name of SHARED_ENTRIES) {
    if (await ensureSharedEntry(sourceHome, wrapperHome, name, platform, allowActiveRuntimeSidecars)) sharedEntries.push(name);
  }
  const projectState = await repairWrapperProjectState({ sourceHome, wrapperHome });
  const metadataPath = path.join(wrapperHome, "wrapper-context.json");
  await fs.writeFile(metadataPath, JSON.stringify({
    version: 2,
    defaultContextMode: "model-default",
    perThreadContextWindow: requestedContextWindow,
    sourceHome,
    sharedEntries,
    attachedRuntimeSidecarsAllowed: Boolean(allowActiveRuntimeSidecars)
  }, null, 2), { mode: 0o600 });
  return { wrapperHome, configPath, metadataPath, requestedContextWindow, sharedEntries, projectState };
}
