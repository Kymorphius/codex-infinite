import { execFile as nodeExecFile } from "node:child_process";
import { spawn as nodeSpawn } from "node:child_process";
import crypto from "node:crypto";
import { promisify } from "node:util";
import { normalizePeerSnapshot } from "./peer-contract.mjs";
import { normalizePeerActivity } from "./conversation-activity.mjs";
import { ACTION_HEADERS, loadActionKey, signPeerAction } from "./peer-action-auth.mjs";

const execFile = promisify(nodeExecFile);
const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024;
const MAX_ACTIVITY_BYTES = 512 * 1024;
const THREAD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/;
const ACTION_PATH = "/api/node/actions/message";

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

export function sshActionArguments(transport, headers) {
  const arguments_ = sshSnapshotArguments(transport);
  const url = arguments_.pop().replace("/api/node/snapshot", ACTION_PATH);
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

  async sendMessage(threadId, prompt) {
    if (!THREAD_ID_PATTERN.test(String(threadId || ""))) throw new Error("Peer action thread id is invalid");
    const key = await loadActionKey(this.actionKeyPath);
    const timestamp = String(Date.now());
    const nonce = crypto.randomUUID();
    const body = Buffer.from(JSON.stringify({ threadId, prompt, requestId: nonce }), "utf8");
    const headers = {
      [ACTION_HEADERS.timestamp]: timestamp,
      [ACTION_HEADERS.nonce]: nonce
    };
    headers[ACTION_HEADERS.signature] = signPeerAction(key, { method: "POST", path: ACTION_PATH, timestamp, nonce, body });
    for (const transport of this.peer.transports) {
      try {
        const payload = JSON.parse(await executeAction(this.spawn, sshActionArguments(transport, headers), body));
        if (payload.status !== "ok" || !payload.accepted) {
          const rejected = new Error(payload.message || "所属节点拒绝了消息");
          rejected.remoteRejected = true;
          throw rejected;
        }
        return { accepted: true, duplicate: Boolean(payload.duplicate), transport: transport.type };
      } catch (error) {
        if (error.remoteRejected) throw error;
        this.logger.warn?.(`[codex-control-console] peer ${this.peer.id} message transport ${transport.type} unavailable`);
      }
    }
    const error = new Error(`${this.peer.name} 暂时不可达，消息未发送。`);
    error.statusCode = 503;
    throw error;
  }
}
