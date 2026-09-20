import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
const ROUTER_BEGIN = "# BEGIN codex-router-managed";
const ROOT_BASE = /^\s*openai_base_url\s*=\s*"([^"]+)"\s*$/;

function rootBoundary(lines) {
  const index = lines.findIndex((line) => /^\s*\[/.test(line));
  return index < 0 ? lines.length : index;
}

function managedRouterPort(lines) {
  const provider = lines.findIndex((line) => /^\s*\[model_providers\.codex-router\]\s*$/.test(line));
  if (provider < 0) return "4202";
  for (let index = provider + 1; index < lines.length && !/^\s*\[/.test(lines[index]); index += 1) {
    const value = lines[index].match(/^\s*base_url\s*=\s*"([^"]+)"\s*$/)?.[1];
    try {
      const url = new URL(value);
      if (url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname) && url.port) return url.port;
    } catch {}
  }
  return "4202";
}

export function applyJevTransportModeToConfig(source, mode, callerSecret = "") {
  if (!["native", "router"].includes(mode)) throw new Error("Jev 传输方式无效");
  const lines = String(source || "").split(/\r?\n/), boundary = rootBoundary(lines);
  const markers = lines.slice(0, boundary).flatMap((line, index) => line.trim() === ROUTER_BEGIN ? [index] : []);
  if (markers.length !== 1) throw new Error("加强版 Router 根配置标记缺失或重复，未自动改写");
  const bases = lines.slice(0, boundary).flatMap((line, index) => ROOT_BASE.test(line) ? [index] : []);
  if (bases.length > 1) throw new Error("加强版存在多个根级 openai_base_url，未自动改写");
  if (bases.length === 1 && bases[0] < markers[0]) throw new Error("根级 openai_base_url 不属于加强版 Router 管理区，未自动改写");
  if (mode === "native") return lines.filter((_line, index) => !bases.includes(index)).join("\n");
  const secret = String(callerSecret || "").trim();
  if (!/^[A-Za-z0-9_-]{32,}$/.test(secret)) throw new Error("Router 调用凭证缺失或无效，请先修复 Codex Router");
  const base = `http://127.0.0.1:${managedRouterPort(lines)}/_codex-router/${secret}/jev/v1`;
  if (bases.length === 1) lines[bases[0]] = `openai_base_url = ${JSON.stringify(base)}`;
  else lines.splice(markers[0] + 1, 0, `openai_base_url = ${JSON.stringify(base)}`);
  return lines.join("\n");
}

export class JevTransportModeManager {
  constructor({ configPath, callerSecretPath } = {}) {
    Object.assign(this, { configPath, callerSecretPath });
    this.last = { mode: "router", runtimeRestartRequired: false, routerRestarted: false };
    this.appliedMode = null;
  }

  async privateWrite(filePath, contents) {
    await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
    try { await fs.writeFile(temporary, contents, { mode: 0o600 }); await fs.rename(temporary, filePath); }
    finally { await fs.rm(temporary, { force: true }); }
  }

  async apply(mode) {
    if (this.appliedMode === mode) return this.status();
    const current = await fs.readFile(this.configPath, "utf8");
    const callerSecret = mode === "router" ? await fs.readFile(this.callerSecretPath, "utf8") : "";
    const next = applyJevTransportModeToConfig(current, mode, callerSecret);
    const runtimeRestartRequired = next !== current;
    if (runtimeRestartRequired) await this.privateWrite(this.configPath, next);
    this.last = { mode, runtimeRestartRequired, routerRestarted: false };
    this.appliedMode = mode;
    return this.last;
  }

  status() { return { ...this.last }; }
}
