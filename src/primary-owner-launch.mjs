import fs from "node:fs/promises";
import path from "node:path";
import { execFile as nodeExecFile, spawn as nodeSpawn } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(nodeExecFile);

function parseProcesses(stdout) {
  return String(stdout || "").split(/\n/).flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(.+)$/);
    return match ? [{ pid: Number(match[1]), command: match[2] }] : [];
  });
}

export class PrimaryOwnerLauncher {
  constructor({ config, execFileImpl = execFile, spawnImpl = nodeSpawn, killImpl = process.kill, waitImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
    this.config = config;
    this.execFile = execFileImpl;
    this.spawn = spawnImpl;
    this.kill = killImpl;
    this.wait = waitImpl;
  }

  async findPrimaryProcess() {
    const executable = path.join(this.config.appPath, "Contents", "MacOS", "ChatGPT");
    const { stdout } = await this.execFile("/bin/ps", ["-axo", "pid=,command="]);
    return parseProcesses(stdout).find(({ command }) => command === executable || (
      command.startsWith(`${executable} `) && !command.includes(`--user-data-dir=${this.config.profileDirectory}`)
    )) || null;
  }

  async relaunch({ confirmIdle = false, activeThreadIds = [] } = {}) {
    if (!confirmIdle) throw new Error("必须明确确认原生 ChatGPT 当前空闲");
    if (activeThreadIds.length) throw new Error(`原生 ChatGPT 仍有 ${activeThreadIds.length} 个任务在运行，已拒绝重启`);
    const executable = path.join(this.config.appPath, "Contents", "MacOS", "ChatGPT");
    await fs.access(executable);
    const existing = await this.findPrimaryProcess();
    if (existing) {
      this.kill(existing.pid, "SIGTERM");
      await this.wait(1200);
      if ((await this.findPrimaryProcess())?.pid === existing.pid) throw new Error("原生 ChatGPT 未正常退出，未强制终止");
    }
    const environment = { ...process.env };
    delete environment.CODEX_HOME;
    delete environment.CODEX_CONTROL_WRAPPER_SIGNATURE;
    const child = this.spawn(executable, [
      `--user-data-dir=${this.config.primaryProfileDirectory}`,
      `--remote-debugging-address=${this.config.primaryCdpHost}`,
      `--remote-debugging-port=${this.config.primaryCdpPort}`,
      `--remote-allow-origins=${this.config.primaryCdpOrigin}`
    ], { detached: true, stdio: "ignore", env: environment });
    child.unref?.();
    return { launched: true };
  }
}
