import crypto from "node:crypto";
import { spawn as nodeSpawn } from "node:child_process";
import { ACTION_HEADERS, loadActionKey, signPeerAction } from "./peer-action-auth.mjs";
import { PROJECT_SYNC_NODE_PREFIX, PROJECT_SYNC_PACKAGE_BYTES, PROJECT_SYNC_SMALL_BODY_BYTES, sshProjectSyncArguments } from "./project-sync-peer-commands.mjs";

const MUTATIONS = new Set(["prepare", "apply", "associate", "dissociate", "createPrepare", "createApply", "createResume", "conversationPrepare", "conversationApply", "conversationResume"]);
const REQUEST_TIMEOUT_MS = 65_000;
const VERIFIED_TRANSPORT_TTL_MS = 60_000;

function syncError(message, statusCode = 503, code = "PROJECT_SYNC_UNAVAILABLE") {
  return Object.assign(new Error(message), { statusCode, code });
}

function execute(spawnImpl, args, body, maxBytes, timeoutMs) {
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawnImpl("ssh", args, { stdio: ["pipe", "pipe", "pipe"] }); }
    catch { reject(syncError("项目同步连接启动失败")); return; }
    let settled = false;
    let size = 0;
    const chunks = [];
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) { try { child.kill(); } catch {} reject(error); }
      else resolve(value);
    };
    const timer = setTimeout(() => finish(syncError("项目同步连接超时")), timeoutMs);
    child.stdout.on("data", (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) finish(syncError("项目同步响应过大", 502));
      else chunks.push(Buffer.from(chunk));
    });
    // Drain stderr without retaining shell output, which can contain paths or credentials.
    child.stderr.on("data", () => {});
    child.stdout.once("error", () => finish(syncError("项目同步响应读取失败")));
    child.stderr.once("error", () => finish(syncError("项目同步连接失败")));
    child.stdin.once("error", () => finish(syncError("项目同步请求传输中断")));
    child.once("error", () => finish(syncError("项目同步连接失败")));
    child.once("close", (code) => {
      if (code !== 0) finish(syncError("项目同步连接中断"));
      else finish(null, Buffer.concat(chunks).toString("utf8"));
    });
    try { child.stdin.end(body); }
    catch { finish(syncError("项目同步请求传输中断")); }
  });
}

export class SshProjectSyncAdapter {
  #verifiedTransport;
  #verifiedUntil = 0;

  constructor({ peer, actionKeyPath, spawnImpl = nodeSpawn, logger = console } = {}) {
    Object.assign(this, { peer, actionKeyPath, spawn: spawnImpl, logger });
  }

  createOptions(input = {}) { return this.request("createOptions", input); }
  createPrepare(input) { return this.request("createPrepare", input); }
  createResume(input) { return this.request("createResume", input); }
  createApply(input) { return this.request("createApply", input); }
  conversationList(input) { return this.request("conversationList", input); }
  conversationOperations(input = {}) { return this.request("conversationOperations", input); }
  conversationExport(input) { return this.request("conversationExport", input); }
  conversationPrepare(input) { return this.request("conversationPrepare", input); }
  conversationApply(input) { return this.request("conversationApply", input); }
  conversationResume(input) { return this.request("conversationResume", input); }

  catalog() { return this.request("catalog", {}); }
  inspect(input) { return this.request("inspect", input); }
  export(input) { return this.request("export", input); }
  prepare(input) { return this.request("prepare", input); }
  apply(input) { return this.request("apply", input); }
  associate(input) { return this.request("associate", input); }
  dissociate(input) { return this.request("dissociate", input); }

  async request(action, input) {
    const mutation = MUTATIONS.has(action);
    const body = Buffer.from(JSON.stringify(input ?? {}), "utf8");
    const maxRequestBytes = ["prepare", "createPrepare", "conversationPrepare"].includes(action) ? PROJECT_SYNC_PACKAGE_BYTES : PROJECT_SYNC_SMALL_BODY_BYTES;
    if (body.length > maxRequestBytes) throw syncError("项目同步请求过大", 413, "PROJECT_SYNC_TOO_LARGE");
    const key = await loadActionKey(this.actionKeyPath);
    const maxResponseBytes = ["export", "conversationExport"].includes(action) ? PROJECT_SYNC_PACKAGE_BYTES : ["catalog", "conversationList", "conversationOperations"].includes(action) ? 2 * 1024 * 1024 : 64 * 1024;
    const deadline = Date.now() + REQUEST_TIMEOUT_MS;
    const preferred = Date.now() < this.#verifiedUntil && this.peer.transports.includes(this.#verifiedTransport) ? this.#verifiedTransport : null;
    const transports = preferred ? [preferred, ...this.peer.transports.filter((transport) => transport !== preferred)] : this.peer.transports;
    for (const transport of transports) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) break;
      const timestamp = String(Date.now());
      const nonce = crypto.randomUUID();
      const headers = { [ACTION_HEADERS.timestamp]: timestamp, [ACTION_HEADERS.nonce]: nonce };
      headers[ACTION_HEADERS.signature] = signPeerAction(key, { method: "POST", path: `${PROJECT_SYNC_NODE_PREFIX}${action}`, timestamp, nonce, body });
      const args = sshProjectSyncArguments(transport, headers, action, { remotePlatform: this.peer.platform, timeoutSeconds: Math.min(60, Math.ceil(remainingMs / 1000)), bodyLength: body.length });
      try {
        const payload = JSON.parse(await execute(this.spawn, args, body, maxResponseBytes, remainingMs));
        if (payload?.status === "error") {
          const message = ["Method not allowed", "Not found"].includes(payload.message)
            ? "该设备尚未提供项目同步功能，请先升级该设备的控制台"
            : typeof payload.message === "string" ? payload.message.slice(0, 1200) : "所属设备拒绝了项目同步请求";
          const error = syncError(message, 409, "PROJECT_SYNC_REJECTED");
          error.remoteRejected = true;
          throw error;
        }
        if (payload?.status !== "ok" || !Object.hasOwn(payload, "result")) throw syncError("所属设备返回的项目同步响应无效", 502);
        if (!mutation) {
          this.#verifiedTransport = transport;
          this.#verifiedUntil = Date.now() + VERIFIED_TRANSPORT_TTL_MS;
        }
        return payload.result;
      } catch (error) {
        if (!mutation && transport === this.#verifiedTransport) this.#verifiedUntil = 0;
        if (error.remoteRejected) throw error;
        this.logger.warn?.(`[codex-control-console] peer ${this.peer.id} project sync ${action} transport unavailable`);
        if (mutation) throw syncError("项目同步请求结果未知，请刷新并重新预检；不会自动重试写入。", 503, "PROJECT_SYNC_RESULT_UNKNOWN");
      }
    }
    throw syncError(`${this.peer.name} 暂时无法读取项目同步状态。`);
  }
}
