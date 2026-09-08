import { spawn, execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { openSync, closeSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findCdpProcess } from './launcher.mjs';
import { resolveDesktopExecutable } from './desktop-host.mjs';
const execFile = promisify(nodeExecFile);
export const SERVICE_NAME = 'dev.codex-control-console';
export async function inspectRestartTarget(config, { platform = process.platform, execute = execFile } = {}) {
  const executable = await resolveDesktopExecutable({ config, platform, execFileImpl: execute });
  return findCdpProcess({ port: config.cdpPort, executable, platform, execFileImpl: execute });
}
export function serviceManagerCommands(platform, uid) {
  if (platform === 'darwin' && Number.isInteger(uid)) {
    const target = `gui/${uid}/${SERVICE_NAME}`;
    return { check: ['/bin/launchctl', ['print', target]], restart: ['/bin/launchctl', ['kickstart', '-k', target]] };
  }
  if (platform === 'win32') return {
    check: ['powershell.exe', ['-NoProfile', '-Command', "$ErrorActionPreference='Stop'; Get-ScheduledTask -TaskName 'Codex Control Console' | Out-Null"]],
    restart: ['powershell.exe', ['-NoProfile', '-Command', "Start-Sleep -Seconds 3; Start-ScheduledTask -TaskName 'Codex Control Console'"]]
  };
  throw new Error('当前系统暂不支持面板重启');
}
export function assertDedicatedProfile(processInfo, config, platform) {
  if (!processInfo) return;
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const normalize = value => platform === 'win32' ? paths.resolve(value).toLowerCase() : paths.resolve(value);
  if (!Number.isInteger(processInfo.pid) || processInfo.pid <= 1 || !processInfo.profileDirectory || normalize(processInfo.profileDirectory) !== normalize(config.profileDirectory)) throw new Error('无法确认专用窗口身份，未执行重启');
}
export class RuntimeRestartService {
  constructor({ config, prepare = async () => {}, platform = process.platform, uid = process.getuid?.(), exec = execFile,
    inspect = async () => inspectRestartTarget(config, { platform, execute: exec }),
    launch = null } = {}) {
    Object.assign(this, { config, prepare, platform, uid, exec, inspect });
    this.instanceId = randomUUID(); this.pending = null; this.accepted = false;
    this.launch = launch || (() => {
      mkdirSync(config.wrapperCodexHome, { recursive: true, mode: 0o700 });
      const log = openSync(path.join(config.wrapperCodexHome, 'runtime-restart.log'), 'a', 0o600);
      try {
        const helper = fileURLToPath(new URL('../scripts/restart-runtime.mjs', import.meta.url));
        const child = spawn(process.execPath, [helper, String(process.pid), this.instanceId], { detached: true, stdio: ['ignore', log, log], windowsHide: true, env: process.env });
        return new Promise((resolve, reject) => { child.once('error', reject); child.once('spawn', () => { child.unref(); resolve(); }); });
      } finally { closeSync(log); }
    });
  }
  status() { return { instanceId: this.instanceId, restarting: this.accepted }; }
  async request() {
    if (this.accepted) return this.status();
    if (!this.pending) this.pending = (async () => {
      const commands = serviceManagerCommands(this.platform, this.uid);
      await this.exec(...commands.check);
      assertDedicatedProfile(await this.inspect(), this.config, this.platform);
      await this.launch();
      this.accepted = true;
      await this.prepare();
      return this.status();
    })().finally(() => { this.pending = null; });
    return this.pending;
  }
}
