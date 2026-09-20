import { spawn as nodeSpawn, execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveDesktopExecutable } from "./desktop-host.mjs";

const execFile = promisify(nodeExecFile);

export function nativeAppLaunchPlan(config, platform = process.platform) {
  if (platform === "darwin") return { executable: "/usr/bin/open", args: ["-a", config.appPath], options: { detached: true, stdio: "ignore" } };
  if (platform === "win32") return { executable: config.appPath, args: [], options: { detached: true, stdio: "ignore", windowsHide: false } };
  throw new Error("当前系统暂不支持启动原生 Codex");
}

export class NativeAppLaunchService {
  constructor({ config, platform = process.platform, resolveExecutable = ({ config, platform }) => resolveDesktopExecutable({ config, platform, execFileImpl: execFile }), spawn = nodeSpawn } = {}) {
    Object.assign(this, { config, platform, resolveExecutable, spawn });
  }

  async launch() {
    const executable = await this.resolveExecutable({ config: this.config, platform: this.platform });
    const plan = nativeAppLaunchPlan({ ...this.config, appPath: this.platform === "win32" ? executable : this.config.appPath }, this.platform);
    const child = this.spawn(plan.executable, plan.args, plan.options);
    await new Promise((resolve, reject) => {
      child.once?.("error", reject);
      child.once?.("spawn", resolve);
      if (!child.once) resolve();
    });
    child.unref?.();
    return { started: true };
  }
}
