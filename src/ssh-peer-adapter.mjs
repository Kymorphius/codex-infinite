import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";
import { normalizePeerSnapshot } from "./peer-contract.mjs";

const execFile = promisify(nodeExecFile);
const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024;

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
}
