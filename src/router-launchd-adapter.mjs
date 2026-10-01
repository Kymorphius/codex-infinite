import { execFile as nodeExecFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";

const execFile = promisify(nodeExecFile);
const LAUNCHCTL = "/bin/launchctl";
const LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

// Top-level (one tab) keys of `launchctl print`; nested endpoint blocks are ignored.
export function parseLaunchctlPrint(text) {
  const field = (name) => String(text).match(new RegExp(`^\\t${name} = ([^\\n]+)$`, "mu"))?.[1]?.trim() ?? null;
  const pid = Number(field("pid"));
  return { state: field("state") || "loaded", pid: Number.isInteger(pid) && pid > 0 ? pid : null };
}

// `print-disabled` lists only labels with an explicit override; absence means enabled.
export function parseDisabledOverride(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const value = String(text).match(new RegExp(`"${escaped}" => (\\w+)`, "u"))?.[1];
  return value === "disabled" || value === "true" ? false : true;
}

// Only the documented fields leave the probe; session names and models are dropped.
export function normalizeRouterHealth(body) {
  const degraded = Array.isArray(body?.degraded) ? body.degraded.slice(0, 10).map((item) => String(item?.name ?? item).slice(0, 80)) : [];
  const activeCount = Number(body?.activity?.activeCount);
  return {
    reachable: true,
    ok: body?.ok === true,
    version: typeof body?.version === "string" ? body.version.slice(0, 40) : null,
    degraded,
    activeCount: Number.isInteger(activeCount) && activeCount >= 0 ? activeCount : null
  };
}

export function routerHealthUrl(origin) {
  const url = new URL(origin);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port) throw new Error("Router 地址必须是 127.0.0.1 HTTP origin");
  return `${url.origin}/health`;
}

export class RouterLaunchdAdapter {
  constructor({ label, plistPath, routerOrigin, platform = process.platform, uid = process.getuid?.(), exec = execFile,
    exists = (file) => access(file).then(() => true, () => false), fetchImpl = fetch, timeoutMs = 2500 }) {
    if (!LABEL.test(label || "")) throw new Error("Router LaunchAgent 标签无效");
    Object.assign(this, { label, plistPath, routerOrigin, platform, uid, exec, exists, fetchImpl, timeoutMs });
    this.domain = `gui/${uid}`;
    this.target = `${this.domain}/${label}`;
  }

  get supported() { return this.platform === "darwin" && Number.isInteger(this.uid); }

  async inspectService() {
    if (!this.supported) return { supported: false, label: this.label };
    const installed = await this.exists(this.plistPath);
    const disabledText = await this.exec(LAUNCHCTL, ["print-disabled", this.domain]).then((result) => result.stdout, () => "");
    const printed = await this.exec(LAUNCHCTL, ["print", this.target]).then((result) => result.stdout, () => null);
    const details = printed ? parseLaunchctlPrint(printed) : { state: "not loaded", pid: null };
    return { supported: true, label: this.label, installed, enabled: parseDisabledOverride(disabledText, this.label), loaded: Boolean(printed), ...details };
  }

  async probeHealth() {
    try {
      const response = await this.fetchImpl(routerHealthUrl(this.routerOrigin), { cache: "no-store", signal: AbortSignal.timeout(this.timeoutMs) });
      const body = await response.json().catch(() => null);
      return { ...normalizeRouterHealth(body), ok: response.ok && body?.ok === true };
    } catch {
      return { reachable: false, ok: false, version: null, degraded: [], activeCount: null };
    }
  }

  async bootstrap() {
    if (!this.supported) throw new Error("当前系统不支持 Router 服务管理");
    await this.exec(LAUNCHCTL, ["bootstrap", this.domain, this.plistPath]);
  }

  async kickstart() {
    if (!this.supported) throw new Error("当前系统不支持 Router 服务管理");
    await this.exec(LAUNCHCTL, ["kickstart", "-k", this.target]);
  }
}
