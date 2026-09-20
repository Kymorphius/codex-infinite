import crypto from "node:crypto";
import { execFile as nodeExecFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(nodeExecFile);
const ROUTER_BEGIN = "# BEGIN codex-router-managed";
const ROOT_BASE = /^\s*openai_base_url\s*=\s*"([^"]+)"\s*$/;

function rootBoundary(lines) {
  const index = lines.findIndex((line) => /^\s*\[/.test(line));
  return index < 0 ? lines.length : index;
}

function managedRouterBase(lines) {
  const provider = lines.findIndex((line) => /^\s*\[model_providers\.codex-router\]\s*$/.test(line));
  if (provider < 0) return "http://127.0.0.1:4202/v1";
  for (let index = provider + 1; index < lines.length && !/^\s*\[/.test(lines[index]); index += 1) {
    const value = lines[index].match(/^\s*base_url\s*=\s*"([^"]+)"\s*$/)?.[1];
    if (value && /^http:\/\/(?:127\.0\.0\.1|localhost):\d+\/v1\/?$/.test(value)) return value.replace(/\/$/, "");
  }
  return "http://127.0.0.1:4202/v1";
}

export function applyJevTransportModeToConfig(source, mode) {
  if (!["native", "router"].includes(mode)) throw new Error("Jev 传输方式无效");
  const lines = String(source || "").split(/\r?\n/), boundary = rootBoundary(lines);
  const markers = lines.slice(0, boundary).flatMap((line, index) => line.trim() === ROUTER_BEGIN ? [index] : []);
  if (markers.length !== 1) throw new Error("加强版 Router 根配置标记缺失或重复，未自动改写");
  const bases = lines.slice(0, boundary).flatMap((line, index) => ROOT_BASE.test(line) ? [index] : []);
  if (bases.length > 1) throw new Error("加强版存在多个根级 openai_base_url，未自动改写");
  if (bases.length === 1 && bases[0] < markers[0]) throw new Error("根级 openai_base_url 不属于加强版 Router 管理区，未自动改写");
  if (mode === "native") return lines.filter((_line, index) => !bases.includes(index)).join("\n");
  if (bases.length === 1) return String(source || "");
  lines.splice(markers[0] + 1, 0, `openai_base_url = ${JSON.stringify(managedRouterBase(lines))}`);
  return lines.join("\n");
}

export class JevTransportModeManager {
  constructor({ configPath, discoveryPath, platform = process.platform, uid = process.getuid?.(), execute = execFile } = {}) {
    Object.assign(this, { configPath, discoveryPath, platform, uid, execute });
    this.last = { mode: "router", runtimeRestartRequired: false, routerRestarted: false };
    this.appliedMode = null;
  }

  async privateWrite(filePath, contents) {
    await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
    try { await fs.writeFile(temporary, contents, { mode: 0o600 }); await fs.rename(temporary, filePath); }
    finally { await fs.rm(temporary, { force: true }); }
  }

  async enableRouterAuthentication() {
    let enabled = false;
    try { enabled = JSON.parse(await fs.readFile(this.discoveryPath, "utf8"))?.discovery === "enabled"; } catch {}
    if (enabled) return false;
    await this.privateWrite(this.discoveryPath, `${JSON.stringify({ version: 1, discovery: "enabled" }, null, 2)}\n`);
    if (this.platform === "darwin" && Number.isInteger(this.uid)) {
      await this.execute("/bin/launchctl", ["kickstart", "-k", `gui/${this.uid}/io.github.codex-router`]);
      return true;
    }
    return false;
  }

  async apply(mode) {
    if (this.appliedMode === mode) return this.status();
    const current = await fs.readFile(this.configPath, "utf8");
    const next = applyJevTransportModeToConfig(current, mode);
    const runtimeRestartRequired = next !== current;
    if (runtimeRestartRequired) await this.privateWrite(this.configPath, next);
    const routerRestarted = mode === "router" ? await this.enableRouterAuthentication() : false;
    this.last = { mode, runtimeRestartRequired, routerRestarted };
    this.appliedMode = mode;
    return this.last;
  }

  status() { return { ...this.last }; }
}
