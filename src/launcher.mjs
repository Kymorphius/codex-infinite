import fs from "node:fs/promises";
import { execFile as nodeExecFile, spawn as nodeSpawn } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { assertLoopbackConfig } from "./loopback.mjs";
import { fetchJson } from "./cdp-client.mjs";

const execFile = promisify(nodeExecFile);

export function extractCdpProfile(command, port) {
  const portPattern = new RegExp(`--remote-debugging-port=${port}(?:\\s|$)`);
  if (!portPattern.test(command)) return null;
  const match = command.match(/--user-data-dir=(.+?)(?= --[a-z-]+(?:=|\s)|$)/);
  return match ? match[1] : null;
}

export async function findCdpProcess({ port, execFileImpl = execFile } = {}) {
  try {
    const { stdout } = await execFileImpl("ps", ["-axo", "pid=,command="]);
    const lines = String(stdout).split(/\n/).map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      if (!line.includes("/Applications/ChatGPT.app/") || !line.includes(`--remote-debugging-port=${port}`)) continue;
      const firstSpace = line.indexOf(" ");
      const pid = Number.parseInt(firstSpace > 0 ? line.slice(0, firstSpace) : line, 10);
      const command = firstSpace > 0 ? line.slice(firstSpace).trim() : line;
      return { pid: Number.isInteger(pid) ? pid : null, command, profileDirectory: extractCdpProfile(command, port) };
    }
  } catch {
    return null;
  }
  return null;
}

function wrapperSignature(config) {
  return Buffer.from(`${path.resolve(config.wrapperCodexHome || "")}\n${config.wrapperContextWindow || ""}`, "utf8").toString("base64url");
}

async function processWrapperSignature(pid, execFileImpl) {
  if (!pid) return null;
  try {
    const { stdout } = await execFileImpl("ps", ["eww", "-p", String(pid), "-o", "command="]);
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
  waitImpl = wait,
  maxWaitMs = 30000,
  pollMs = 300
} = {}) {
  assertLoopbackConfig(config);
  const endpoint = `${config.cdpOrigin}/json/version`;
  const existingProcess = await findCdpProcess({ port: config.cdpPort, execFileImpl });
  let existingEndpoint = null;
  try {
    existingEndpoint = await fetchJson(endpoint, { fetchImpl, timeoutMs: 1500 });
  } catch {
    existingEndpoint = null;
  }

  if (existingEndpoint) {
    const profileDirectory = existingProcess?.profileDirectory;
    if (profileDirectory && path.resolve(profileDirectory) === path.resolve(config.profileDirectory)) {
      const activeSignature = await processWrapperSignature(existingProcess.pid, execFileImpl);
      if (config.wrapperCodexHome && activeSignature !== wrapperSignature(config)) {
        throw new Error("包装版 Codex 仍在使用旧配置。请完全退出专用 Codex 窗口后重新运行 npm start，以启用常规聊天扩展上下文。");
      }
      return { mode: "attached", pid: existingProcess.pid, profileDirectory, version: existingEndpoint.Browser || null };
    }
    const detail = profileDirectory ? `profile ${profileDirectory}` : "an unknown process";
    throw new Error(`CDP port ${config.cdpPort} is already owned by ${detail}; refusing to disturb it. Close that dedicated instance or choose another port.`);
  }

  const executable = path.join(config.appPath, "Contents", "MacOS", "ChatGPT");
  try {
    await fs.access(executable);
  } catch {
    throw new Error(`ChatGPT.app executable not found at ${executable}`);
  }
  await fs.mkdir(config.profileDirectory, { recursive: true });
  const child = spawnImpl(executable, [
    `--user-data-dir=${config.profileDirectory}`,
    `--remote-debugging-address=${config.cdpHost}`,
    `--remote-debugging-port=${config.cdpPort}`,
    `--remote-allow-origins=${config.cdpOrigin}`
  ], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      ...(config.wrapperCodexHome ? { CODEX_HOME: config.wrapperCodexHome } : {}),
      CODEX_CONTROL_WRAPPER_CONTEXT_WINDOW: String(config.wrapperContextWindow || ""),
      CODEX_CONTROL_WRAPPER_SIGNATURE: wrapperSignature(config)
    }
  });
  child.unref?.();

  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    try {
      const version = await fetchJson(endpoint, { fetchImpl, timeoutMs: Math.min(1500, Math.max(200, deadline - Date.now())) });
      const processInfo = await findCdpProcess({ port: config.cdpPort, execFileImpl });
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
