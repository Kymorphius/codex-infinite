import { spawn as nodeSpawn } from "node:child_process";

export const NATIVE_DASHBOARD_BINDING = "codexControlConsoleOpenDashboard";
export const NATIVE_DASHBOARD_MODULES = Object.freeze(["board", "console", "sessions", "priority", "projects", "conversations", "terminal"]);

export function normalizeNativeDashboardRequest(payload) {
  let request;
  try { request = JSON.parse(String(payload || "")); } catch { return null; }
  if (request?.module === "restart") return request.confirm === true && Object.keys(request).every(key => ["module", "confirm"].includes(key)) ? { module: "restart", confirm: true } : null;
  return NATIVE_DASHBOARD_MODULES.includes(request?.module) ? { module: request.module } : null;
}

export function nativeDashboardLaunchPlan(platform = process.platform) {
  if (platform !== "darwin") throw new Error("独立加强版窗口当前仅用于 macOS 兼容模式");
  return {
    executable: "/usr/bin/open",
    args: ["-b", "dev.codex-control-console.launcher"],
    options: { detached: true, stdio: "ignore" }
  };
}

export class NativeDashboardLaunchService {
  constructor({ platform = process.platform, spawn = nodeSpawn, restart = null } = {}) {
    Object.assign(this, { platform, spawn, restart });
  }

  async open(payload) {
    const request = normalizeNativeDashboardRequest(payload);
    if (!request) throw new Error("控制台模块无效");
    if (request.module === "restart") {
      if (!this.restart) throw new Error("重启服务尚未就绪");
      return this.restart();
    }
    const plan = nativeDashboardLaunchPlan(this.platform);
    const child = this.spawn(plan.executable, plan.args, plan.options);
    await new Promise((resolve, reject) => {
      child.once?.("error", reject);
      child.once?.("spawn", resolve);
      if (!child.once) resolve();
    });
    child.unref?.();
    return { opened: true, module: request.module };
  }
}
