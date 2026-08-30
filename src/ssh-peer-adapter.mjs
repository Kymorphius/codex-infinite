import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";
import { normalizePeerSnapshot } from "./peer-contract.mjs";
import { normalizePeerActivity } from "./conversation-activity.mjs";

const execFile = promisify(nodeExecFile);
const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024;
const MAX_ACTIVITY_BYTES = 512 * 1024;
const THREAD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/;

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

export class SshPeerAdapter {
  constructor({ peer, execFileImpl = execFile, logger = console } = {}) {
    this.peer = peer;
    this.execFile = execFileImpl;
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
}
