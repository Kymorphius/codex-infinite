import fs from "node:fs/promises";
import path from "node:path";
import { repairWrapperProjectState } from "./wrapper-project-state.mjs";

const SHARED_ENTRIES = Object.freeze([
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

function positiveInteger(value, label) {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value || ""), 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${label} 必须是正整数`);
  return parsed;
}

export function withWrapperContextConfig(source, contextWindow) {
  const value = positiveInteger(contextWindow, "包装版上下文窗口");
  const lines = String(source || "").replace(/\s+$/, "").split(/\r?\n/);
  const tableIndex = lines.findIndex((line) => /^\s*\[/.test(line));
  const rootEnd = tableIndex < 0 ? lines.length : tableIndex;
  const settings = [
    ["model_context_window", value],
    ["model_auto_compact_token_limit", value]
  ];
  let insertionIndex = rootEnd;
  for (const [key, settingValue] of settings) {
    const existingIndex = lines.slice(0, insertionIndex).findIndex((line) => new RegExp(`^\\s*${key}\\s*=`).test(line));
    const setting = `${key} = ${settingValue}`;
    if (existingIndex >= 0) lines[existingIndex] = setting;
    else {
      lines.splice(insertionIndex, 0, setting);
      insertionIndex += 1;
    }
  }
  if (insertionIndex < lines.length && lines[insertionIndex] !== "") lines.splice(insertionIndex, 0, "");
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
}

async function ensureSharedEntry(sourceHome, wrapperHome, name) {
  const sourcePath = path.join(sourceHome, name);
  const targetPath = path.join(wrapperHome, name);
  try {
    await fs.lstat(sourcePath);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  try {
    const stat = await fs.lstat(targetPath);
    if (!stat.isSymbolicLink()) throw new Error(`包装版 CODEX_HOME 中的 ${name} 已存在且不是符号链接`);
    const currentTarget = path.resolve(wrapperHome, await fs.readlink(targetPath));
    if (currentTarget !== path.resolve(sourcePath)) throw new Error(`包装版 CODEX_HOME 中的 ${name} 指向了其他位置`);
    return true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await fs.symlink(sourcePath, targetPath);
  return true;
}

export async function prepareWrapperCodexHome({ sourceHome, wrapperHome, contextWindow }) {
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
  const config = withWrapperContextConfig(sourceConfig, requestedContextWindow);
  const configPath = path.join(wrapperHome, "config.toml");
  const temporaryPath = `${configPath}.tmp`;
  await fs.writeFile(temporaryPath, config, { mode: 0o600 });
  await fs.rename(temporaryPath, configPath);
  const sharedEntries = [];
  for (const name of SHARED_ENTRIES) {
    if (await ensureSharedEntry(sourceHome, wrapperHome, name)) sharedEntries.push(name);
  }
  const projectState = await repairWrapperProjectState({ sourceHome, wrapperHome });
  const metadataPath = path.join(wrapperHome, "wrapper-context.json");
  await fs.writeFile(metadataPath, JSON.stringify({
    version: 1,
    requestedContextWindow,
    requestedAutoCompactTokenLimit: requestedContextWindow,
    sourceHome,
    sharedEntries
  }, null, 2), { mode: 0o600 });
  return { wrapperHome, configPath, metadataPath, requestedContextWindow, sharedEntries, projectState };
}
