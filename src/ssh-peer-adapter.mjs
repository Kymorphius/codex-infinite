import { execFile as nodeExecFile } from "node:child_process";
import { spawn as nodeSpawn } from "node:child_process";
import crypto from "node:crypto";
import { promisify } from "node:util";
import { normalizePeerSnapshot } from "./peer-contract.mjs";
import { normalizePeerActivity, normalizePeerSessionSettings, normalizePeerSettingsOptions } from "./conversation-activity.mjs";
import { ACTION_HEADERS, loadActionKey, signPeerAction } from "./peer-action-auth.mjs";
import { validateThreadSettingsTransport } from "./thread-settings-control.mjs";

const execFile = promisify(nodeExecFile);
const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024;
const MAX_ACTIVITY_BYTES = 2 * 1024 * 1024;
const THREAD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/;
const MESSAGE_ACTION_PATH = "/api/node/actions/message";
const CONTROL_ACTION_PATH = "/api/node/actions/control";
const SETTINGS_ACTION_PATH = "/api/node/actions/settings";

export function sshSnapshotArguments(transport) {
  const relay = transport.type === "ssh-relay";
  const target = relay ? `${transport.relayUser}@${transport.relayHost}` : `${transport.user}@${transport.host}`;
  const sshPort = relay ? transport.relayPort : transport.port;
  const dashboardPort = relay ? transport.forwardedPort : transport.dashboardPort;
  return [
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=4",
    "-o", "StrictHostKeyChecking=yes",
    "-o", "ServerAliveInterval=3",
    "-o", "ServerAliveCountMax=1",
    "-p", String(sshPort),
    target,
    "/usr/bin/curl", "--fail", "--silent", "--show-error", "--max-time", "6",
    `http://127.0.0.1:${dashboardPort}/api/node/snapshot`
  ];
}

export function sshActivityArguments(transport, threadId) {
  if (!THREAD_ID_PATTERN.test(String(threadId || ""))) throw new Error("Peer activity thread id is invalid");
  const arguments_ = sshSnapshotArguments(transport);
  arguments_[arguments_.length - 1] = arguments_[arguments_.length - 1].replace("/api/node/snapshot", `/api/node/activity/${encodeURIComponent(threadId)}`);
  return arguments_;
}

export function sshActionArguments(transport, headers, actionPath = MESSAGE_ACTION_PATH) {
  if (![MESSAGE_ACTION_PATH, CONTROL_ACTION_PATH, SETTINGS_ACTION_PATH].includes(actionPath)) throw new Error("Peer action path is invalid");
  const arguments_ = sshSnapshotArguments(transport);
  const url = arguments_.pop().replace("/api/node/snapshot", actionPath);
  const failIndex = arguments_.indexOf("--fail");
  if (failIndex >= 0) arguments_.splice(failIndex, 1);
  arguments_.push(
    "-X", "POST",
    "-H", "content-type:application/json",
    "-H", `${ACTION_HEADERS.timestamp}:${headers[ACTION_HEADERS.timestamp]}`,
    "-H", `${ACTION_HEADERS.nonce}:${headers[ACTION_HEADERS.nonce]}`,
    "-H", `${ACTION_HEADERS.signature}:${headers[ACTION_HEADERS.signature]}`,
    "--data-binary", "@-",
    url
  );
  return arguments_;
}

function executeAction(spawnImpl, args, body) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl("ssh", args, { stdio: ["pipe", "pipe", "pipe"] });
    const chunks = [];
    let size = 0;
    let stderr = "";
    const timeout = setTimeout(() => { child.kill(); reject(new Error("Peer action timed out")); }, 15_000);
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > 256 * 1024) child.kill();
      else chunks.push(chunk);
    });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-4000); });
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (size > 256 * 1024) reject(new Error("Peer action response is too large"));
      else if (code !== 0) reject(new Error(stderr.trim() || `Peer action SSH exited ${code}`));
      else resolve(Buffer.concat(chunks).toString("utf8"));
    });
    child.stdin.end(body);
  });
}

export class SshPeerAdapter {
  constructor({ peer, actionKeyPath = null, execFileImpl = execFile, spawnImpl = nodeSpawn, logger = console } = {}) {
    this.peer = peer;
    this.execFile = execFileImpl;
    this.spawn = spawnImpl;
    this.actionKeyPath = actionKeyPath;
    this.logger = logger;
  }

  async listTasks() {
    for (const transport of this.peer.transports) {
      try {
        const { stdout } = await this.execFile("ssh", sshSnapshotArguments(transport), {
          encoding: "utf8",
          timeout: 12000,
          maxBuffer: MAX_SNAPSHOT_BYTES
        });
        const result = normalizePeerSnapshot(this.peer, JSON.parse(stdout));
        return { ...result, transport: transport.type };
      } catch (error) {
        this.logger.warn?.(`[codex-control-console] peer ${this.peer.id} transport ${transport.type} unavailable`);
      }
    }
    const device = Object.freeze({ id: this.peer.id, name: this.peer.name, kind: "remote-codex", location: this.peer.location, status: "error" });
    return { status: "error", source: "federated-peer-snapshot", readOnly: true, tasks: [], devices: [device], message: `${this.peer.name} 暂时不可达。` };
  }

  async getActivity(threadId) {
    if (!THREAD_ID_PATTERN.test(String(threadId || ""))) throw new Error("Peer activity thread id is invalid");
    for (const transport of this.peer.transports) {
      try {
        const { stdout } = await this.execFile("ssh", sshActivityArguments(transport, threadId), {
          encoding: "utf8",
          timeout: 12000,
          maxBuffer: MAX_ACTIVITY_BYTES
        });
        return { ...normalizePeerActivity(this.peer, JSON.parse(stdout)), transport: transport.type };
      } catch {
        this.logger.warn?.(`[codex-control-console] peer ${this.peer.id} activity transport ${transport.type} unavailable`);
      }
    }
    const error = new Error(`${this.peer.name} 暂时不可达。`);
    error.statusCode = 503;
    throw error;
  }

  async sendMessage(threadId, prompt, expectedDraftRevision = null) {
    if (!THREAD_ID_PATTERN.test(String(threadId || ""))) throw new Error("Peer action thread id is invalid");
    const key = await loadActionKey(this.actionKeyPath);
    const timestamp = String(Date.now());
    const nonce = crypto.randomUUID();
    const body = Buffer.from(JSON.stringify({ threadId, prompt, expectedDraftRevision, requestId: nonce }), "utf8");
    const headers = {
      [ACTION_HEADERS.timestamp]: timestamp,
      [ACTION_HEADERS.nonce]: nonce
    };
    headers[ACTION_HEADERS.signature] = signPeerAction(key, { method: "POST", path: MESSAGE_ACTION_PATH, timestamp, nonce, body });
    for (const transport of this.peer.transports) {
      try {
        const payload = JSON.parse(await executeAction(this.spawn, sshActionArguments(transport, headers, MESSAGE_ACTION_PATH), body));
        if (payload.status !== "ok" || !payload.accepted) {
          const rejected = new Error(payload.message || "所属节点拒绝了消息");
          rejected.remoteRejected = true;
          rejected.statusCode = 409;
          throw rejected;
        }
        return {
          accepted: true,
          duplicate: Boolean(payload.duplicate),
          executionAuthority: payload.executionAuthority === "owner-native-desktop" ? "owner-native-desktop" : "unknown",
          transport: transport.type
        };
      } catch (error) {
        if (error.remoteRejected) throw error;
        this.logger.warn?.(`[codex-control-console] peer ${this.peer.id} message transport ${transport.type} unavailable`);
      }
    }
    const error = new Error(`${this.peer.name} 暂时不可达，消息未发送。`);
    error.statusCode = 503;
    throw error;
  }

  async control(threadId, input = {}) {
    if (!THREAD_ID_PATTERN.test(String(threadId || ""))) throw new Error("Peer action thread id is invalid");
    if (!["interrupt", "resolveApproval"].includes(input.action) || !THREAD_ID_PATTERN.test(String(input.turnId || ""))) throw new Error("Peer control action is invalid");
    if (input.action === "resolveApproval" && (!THREAD_ID_PATTERN.test(String(input.approvalToken || "")) || !["accept", "decline"].includes(input.decision))) {
      throw new Error("Peer approval action is invalid");
    }
    const key = await loadActionKey(this.actionKeyPath);
    const timestamp = String(Date.now());
    const nonce = crypto.randomUUID();
    const action = input.action === "resolveApproval"
      ? { threadId, action: "resolveApproval", turnId: input.turnId, approvalToken: input.approvalToken, decision: input.decision, requestId: nonce }
      : { threadId, action: "interrupt", turnId: input.turnId, requestId: nonce };
    const body = Buffer.from(JSON.stringify(action), "utf8");
    const headers = { [ACTION_HEADERS.timestamp]: timestamp, [ACTION_HEADERS.nonce]: nonce };
    headers[ACTION_HEADERS.signature] = signPeerAction(key, { method: "POST", path: CONTROL_ACTION_PATH, timestamp, nonce, body });
    for (const transport of this.peer.transports) {
      try {
        const payload = JSON.parse(await executeAction(this.spawn, sshActionArguments(transport, headers, CONTROL_ACTION_PATH), body));
        if (payload.status !== "ok" || !payload.accepted) {
          const rejected = new Error(payload.message || (input.action === "resolveApproval" ? "所属节点拒绝了审批操作" : "所属节点拒绝了停止请求"));
          rejected.remoteRejected = true;
          rejected.statusCode = 409;
          throw rejected;
        }
        return {
          accepted: true,
          interrupted: Boolean(payload.interrupted),
          approvalResolved: Boolean(payload.approvalResolved),
          decision: ["accept", "decline"].includes(payload.decision) ? payload.decision : null,
          transport: transport.type
        };
      } catch (error) {
        if (error.remoteRejected) throw error;
        this.logger.warn?.(`[codex-control-console] peer ${this.peer.id} control transport ${transport.type} unavailable`);
      }
    }
    const error = new Error(`${this.peer.name} 暂时不可达，未能${input.action === "resolveApproval" ? "处理审批" : "停止这一轮"}。`);
    error.statusCode = 503;
    throw error;
  }

  async updateSettings(threadId, changes = {}) {
    const normalized = validateThreadSettingsTransport({ threadId, changes });
    const key = await loadActionKey(this.actionKeyPath);
    const timestamp = String(Date.now());
    const nonce = crypto.randomUUID();
    const body = Buffer.from(JSON.stringify({ threadId: normalized.threadId, changes: normalized.changes, requestId: nonce }), "utf8");
    const headers = { [ACTION_HEADERS.timestamp]: timestamp, [ACTION_HEADERS.nonce]: nonce };
    headers[ACTION_HEADERS.signature] = signPeerAction(key, { method: "POST", path: SETTINGS_ACTION_PATH, timestamp, nonce, body });
    for (const transport of this.peer.transports) {
      try {
        const payload = JSON.parse(await executeAction(this.spawn, sshActionArguments(transport, headers, SETTINGS_ACTION_PATH), body));
        if (payload.status !== "ok" || !payload.accepted) {
          const rejected = new Error(payload.message || "所属节点拒绝了设置变更");
          rejected.remoteRejected = true;
          rejected.statusCode = 409;
          throw rejected;
        }
        if (payload.duplicate) return {
          accepted: true,
          duplicate: true,
          effectiveFrom: "next-turn",
          activeTurnPreserved: false,
          settings: null,
          settingsOptions: null,
          executionAuthority: "unknown",
          ownerSurface: "unknown",
          ownerBridge: "unknown",
          transport: transport.type
        };
        let settings;
        let settingsOptions;
        try {
          if (!payload.settings || !payload.settingsOptions) throw new Error("missing settings confirmation");
          settings = normalizePeerSessionSettings(payload.settings);
          settingsOptions = normalizePeerSettingsOptions(payload.settingsOptions);
        } catch {
          const invalid = new Error("所属节点返回的设置确认无效");
          invalid.remoteRejected = true;
          invalid.statusCode = 502;
          throw invalid;
        }
        return {
          accepted: true,
          effectiveFrom: payload.effectiveFrom === "next-turn" ? "next-turn" : "unknown",
          activeTurnPreserved: Boolean(payload.activeTurnPreserved),
          settings,
          settingsOptions,
          executionAuthority: payload.executionAuthority === "owner-native-desktop" ? "owner-native-desktop" : "unknown",
          ownerSurface: ["primary-native", "dedicated-native"].includes(payload.ownerSurface) ? payload.ownerSurface : "unknown",
          ownerBridge: ["writer-matched", "dormant-fallback"].includes(payload.ownerBridge) ? payload.ownerBridge : "unknown",
          transport: transport.type
        };
      } catch (error) {
        if (error.remoteRejected) throw error;
        this.logger.warn?.(`[codex-control-console] peer ${this.peer.id} settings transport ${transport.type} unavailable`);
      }
    }
    const error = new Error(`${this.peer.name} 暂时不可达，设置未更改。`);
    error.statusCode = 503;
    throw error;
  }
}
