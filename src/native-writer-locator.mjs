import path from "node:path";
import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(nodeExecFile);
const THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function processTable(stdout) {
  const rows = new Map();
  for (const line of String(stdout || "").split(/\n/)) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
    if (!match) continue;
    rows.set(Number(match[1]), { pid: Number(match[1]), parentPid: Number(match[2]), command: match[3] });
  }
  return rows;
}

function debuggingPort(command) {
  const match = String(command).match(/(?:^|\s)--remote-debugging-port=(\d+)(?:\s|$)/);
  return match ? Number(match[1]) : null;
}

function userDataDirectory(command) {
  return String(command).match(/(?:^|\s)--user-data-dir=(.+?)(?=\s--[a-z-]+(?:=|\s)|$)/)?.[1] || null;
}

function holderPid(stdout) {
  for (const line of String(stdout || "").split(/\n/)) {
    const match = line.match(/^p(\d+)$/);
    if (match) return Number(match[1]);
  }
  return null;
}

function samePath(left, right) {
  return Boolean(left && right) && path.resolve(left) === path.resolve(right);
}

export class NativeWriterLocator {
  constructor({ config, execFileImpl = execFile, maxParentDepth = 8 } = {}) {
    this.config = config;
    this.execFile = execFileImpl;
    this.maxParentDepth = maxParentDepth;
  }

  async locate(threadId) {
    const normalized = String(threadId || "").trim().toLowerCase();
    if (!THREAD_ID_PATTERN.test(normalized)) return { state: "invalid" };
    const lockPath = path.join(this.config.sourceCodexHome, "thread-writer-locks", `${normalized}.lock`);
    let pid = null;
    try {
      pid = holderPid((await this.execFile("/usr/sbin/lsof", ["-Fp", "--", lockPath])).stdout);
    } catch (error) {
      if (![1, 2].includes(error?.code)) return { state: "inspection-unavailable" };
    }
    if (!pid) return this.dormantRoute();

    let table;
    try {
      table = processTable((await this.execFile("/bin/ps", ["-axo", "pid=,ppid=,command="])).stdout);
    } catch {
      return { state: "inspection-unavailable" };
    }
    const executable = path.join(this.config.appPath, "Contents", "MacOS", "ChatGPT");
    let current = table.get(pid);
    for (let depth = 0; current && depth <= this.maxParentDepth; depth += 1) {
      if (current.command.startsWith(executable)) return this.routeForDesktop(current.command);
      current = table.get(current.parentPid);
    }
    return { state: "unknown-writer" };
  }

  dormantRoute() {
    return {
      state: "ready",
      surface: "dedicated-native",
      bridge: "dormant-fallback",
      cdpOrigin: this.config.cdpOrigin
    };
  }

  routeForDesktop(command) {
    const port = debuggingPort(command);
    const profile = userDataDirectory(command);
    if (samePath(profile, this.config.profileDirectory) && port === this.config.cdpPort) {
      return { state: "ready", surface: "dedicated-native", bridge: "writer-matched", cdpOrigin: this.config.cdpOrigin };
    }
    const primaryProfile = !profile || samePath(profile, this.config.primaryProfileDirectory);
    if (!primaryProfile) return { state: "unknown-writer" };
    if (!this.config.primaryCdpEnabled || port !== this.config.primaryCdpPort) {
      return { state: "bridge-unavailable", surface: "primary-native", bridge: "writer-matched" };
    }
    return { state: "ready", surface: "primary-native", bridge: "writer-matched", cdpOrigin: this.config.primaryCdpOrigin };
  }
}
