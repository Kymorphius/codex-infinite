import fs from "node:fs";
import path from "node:path";

export function bundledCodexCandidates(appPath, platform = process.platform) {
  if (platform !== "darwin") return [];
  const resources = path.posix.join(appPath, "Contents", "Resources");
  return Object.freeze([
    path.posix.join(resources, "codex-cli", "bin", "codex"),
    path.posix.join(resources, "codex-cli", "CodexCLI.app", "Contents", "MacOS", "codex"),
    path.posix.join(resources, "codex")
  ]);
}

export function resolveBundledCodexPath(appPath, { platform = process.platform, statSync = fs.statSync } = {}) {
  const candidates = bundledCodexCandidates(appPath, platform);
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // App upgrades may remove an older layout while this compatibility list is evaluated.
    }
  }
  return candidates.at(-1) || "codex";
}
