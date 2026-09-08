import fs from "node:fs/promises";
import { execFile as nodeExecFile, spawn as nodeSpawn } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { assertLoopbackConfig } from "./loopback.mjs";
import { fetchJson } from "./cdp-client.mjs";
import { desktopSpawnOptions, listDesktopProcesses, processSwitchValue, resolveDesktopExecutable } from "./desktop-host.mjs";

const execFile = promisify(nodeExecFile);
export const WRAPPER_DISABLED_FEATURES = "LocalNetworkAccessForSubframeNavigations";

export function extractCdpProfile(command, port) {
  const portPattern = new RegExp(`--remote-debugging-port=${port}(?:\\s|$)`);
  if (!portPattern.test(command)) return null;
  return processSwitchValue(command, "user-data-dir");
}

export async function findCdpProcess({ port, executable, platform = process.platform, execFileImpl = execFile } = {}) {
  try {
    const processes = await listDesktopProcesses({ executable, platform, execFileImpl });
    for (const processInfo of processes) {
      if (!processInfo.command.includes(`--remote-debugging-port=${port}`)) continue;
      return { ...processInfo, profileDirectory: extractCdpProfile(processInfo.command, port) };
    }
  } catch {
    return null;
  }
  return null;
}

export function wrapperSignature(config) {
  return Buffer.from(`per-thread-v6-lna-subframe-only\n${path.resolve(config.wrapperCodexHome || "")}\n${path.resolve(config.nativeCodexHome || config.wrapperCodexHome || "")}\n${config.perThreadContextWindow || ""}`, "utf8").toString("base64url");
}

export async function inspectDedicatedCodex(config, {
  fetchImpl = globalThis.fetch,
  execFileImpl = execFile,
  platform = process.platform
} = {}) {
  assertLoopbackConfig(config);
  const executable = await resolveDesktopExecutable({ config, platform, execFileImpl });
  const endpoint = `${config.cdpOrigin}/json/version`;
  const existingProcess = await findCdpProcess({ port: config.cdpPort, executable, platform, execFileImpl });
  let existingEndpoint = null;
  try {
    existingEndpoint = await fetchJson(endpoint, { fetchImpl, timeoutMs: 1500 });
  } catch {
    return null;
  }
  const profileDirectory = existingProcess?.profileDirectory;
  if (profileDirectory && path.resolve(profileDirectory) === path.resolve(config.profileDirectory)) {
    const activeSignature = await processWrapperSignature(existingProcess, platform, execFileImpl);
    if (config.wrapperCodexHome && activeSignature !== wrapperSignature(config)) {
      throw new Error("包装版 Codex 仍在使用旧配置。请完全退出专用 Codex 窗口后重新运行 npm start，以启用单会话扩展上下文。");
    }
    return { mode: "attached", pid: existingProcess.pid, profileDirectory, version: existingEndpoint.Browser || null };
  }
  const detail = profileDirectory ? `profile ${profileDirectory}` : "an unknown process";
  throw new Error(`CDP port ${config.cdpPort} is already owned by ${detail}; refusing to disturb it. Close that dedicated instance or choose another port.`);
}

async function processWrapperSignature(processInfo, platform, execFileImpl) {
  if (!processInfo?.pid) return null;
  const argumentSignature = processSwitchValue(processInfo.command, "codex-control-wrapper-signature");
  if (argumentSignature) return argumentSignature;
  if (platform !== "darwin") return null;
  try {
    const { stdout } = await execFileImpl("/bin/ps", ["eww", "-p", String(processInfo.pid), "-o", "command="]);
    return String(stdout).match(/(?:^|\s)CODEX_CONTROL_WRAPPER_SIGNATURE=([^\s]+)/)?.[1] || null;
  } catch {
    return null;
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function ensureDedicatedCodex(config, {
  fetchImpl = globalThis.fetch,
  spawnImpl = nodeSpawn,
  execFileImpl = execFile,
  accessImpl = fs.access,
  waitImpl = wait,
  platform = process.platform,
  maxWaitMs = 30000,
  pollMs = 300
} = {}) {
  assertLoopbackConfig(config);
  const executable = await resolveDesktopExecutable({ config, platform, execFileImpl });
  const endpoint = `${config.cdpOrigin}/json/version`;
  const attached = await inspectDedicatedCodex(config, { fetchImpl, execFileImpl, platform });
  if (attached) return attached;

  try {
    await accessImpl(executable);
  } catch {
    throw new Error(`ChatGPT.app executable not found at ${executable}`);
  }
  await fs.mkdir(config.profileDirectory, { recursive: true });
  const child = spawnImpl(executable, [
    `--user-data-dir=${config.profileDirectory}`,
    `--remote-debugging-address=${config.cdpHost}`,
    `--remote-debugging-port=${config.cdpPort}`,
    `--remote-allow-origins=${config.cdpOrigin}`,
    `--disable-features=${WRAPPER_DISABLED_FEATURES}`,
    `--codex-control-wrapper-signature=${wrapperSignature(config)}`
  ], desktopSpawnOptions({
    platform,
    environment: {
      ...process.env,
      ...(config.nativeCodexHome || config.wrapperCodexHome ? { CODEX_HOME: config.nativeCodexHome || config.wrapperCodexHome } : {}),
      CODEX_ELECTRON_USER_DATA_PATH: config.profileDirectory,
      CODEX_CONTROL_PER_THREAD_CONTEXT_WINDOW: String(config.perThreadContextWindow || ""),
      CODEX_CONTROL_WRAPPER_SIGNATURE: wrapperSignature(config)
    }
  }));
  child.unref?.();

  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    try {
      const version = await fetchJson(endpoint, { fetchImpl, timeoutMs: Math.min(1500, Math.max(200, deadline - Date.now())) });
      const processInfo = await findCdpProcess({ port: config.cdpPort, executable, platform, execFileImpl });
      if (processInfo?.profileDirectory && path.resolve(processInfo.profileDirectory) !== path.resolve(config.profileDirectory)) {
        throw new Error(`CDP port ${config.cdpPort} was claimed by a different profile while launching`);
      }
      return { mode: "launched", pid: processInfo?.pid ?? child.pid ?? null, profileDirectory: config.profileDirectory, version: version.Browser || null };
    } catch (error) {
      if (error.message.includes("claimed by a different profile")) throw error;
      await waitImpl(pollMs);
    }
  }
  throw new Error(`Timed out waiting for Codex CDP at ${config.cdpOrigin}`);
}
