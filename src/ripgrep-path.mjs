import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveDesktopExecutable } from "./desktop-host.mjs";

// Windows has no ripgrep on PATH, but the desktop package ships one next to its own resources.
export function bundledRipgrepCandidates(desktopExecutable, platform = process.platform) {
  if (!desktopExecutable) return [];
  if (platform === "win32") return [path.win32.join(path.win32.dirname(desktopExecutable), "resources", "rg.exe")];
  if (platform === "darwin") return [path.posix.join(path.posix.dirname(desktopExecutable), "..", "Resources", "rg")];
  return [];
}

export async function resolveRipgrepPath({ config, env = process.env, platform = process.platform,
  execFileImpl = promisify(execFile), statSync = fs.statSync } = {}) {
  if (env.CODEX_CONTROL_RG_PATH) return env.CODEX_CONTROL_RG_PATH;
  let executable = null;
  try { executable = await resolveDesktopExecutable({ config, platform, execFileImpl }); } catch { /* Fall back to PATH. */ }
  for (const candidate of bundledRipgrepCandidates(executable, platform)) {
    try { if (statSync(candidate).isFile()) return candidate; } catch { /* A package upgrade may have moved it. */ }
  }
  return "rg";
}
