import crypto from "node:crypto";
import { ACTION_HEADERS, loadActionKey, signPeerAction } from "./peer-action-auth.mjs";
import { SKILL_SCHEMA_VERSION, normalizeSkillCatalog, normalizeSkillHash, normalizeSkillLocator, normalizeSkillPackage, serializeSkillPackage } from "./skill-contract.mjs";
import { SKILL_INSTALL_ACTION_PATH, SKILL_TOGGLE_ACTION_PATH, sshActionArguments, sshSkillContentArguments, sshSkillsArguments } from "./ssh-peer-commands.mjs";

const MAX_CATALOG_BYTES = 2 * 1024 * 1024;
const MAX_PACKAGE_BYTES = 4 * 1024 * 1024;
const PROCESS_TIMEOUT_MS = 20_000;

function executeAction(spawnImpl, args, body) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl("ssh", args, { stdio: ["pipe", "pipe", "pipe"] });
    const chunks = [];
    let size = 0;
    let stderr = "";
    const timeout = setTimeout(() => { child.kill(); reject(new Error("Peer Skill action timed out")); }, 15_000);
    child.stdout.on("data", (chunk) => { size += chunk.length; if (size > 256 * 1024) child.kill(); else chunks.push(chunk); });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-4000); });
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (size > 256 * 1024) reject(new Error("Peer Skill action response is too large"));
      else if (code !== 0) reject(new Error(stderr.trim() || `Peer Skill action SSH exited ${code}`));
      else resolve(Buffer.concat(chunks).toString("utf8"));
    });
    child.stdin.end(body);
  });
}

export class SshPeerSkills {
  constructor({ peer, execFile, spawn, actionKeyPath, logger = console } = {}) {
    Object.assign(this, { peer, execFile, spawn, actionKeyPath, logger });
  }

  async list() {
    for (const transport of this.peer.transports) {
      try {
        const { stdout } = await this.execFile("ssh", sshSkillsArguments(transport, { remotePlatform: this.peer.platform }), { encoding: "utf8", timeout: PROCESS_TIMEOUT_MS, maxBuffer: MAX_CATALOG_BYTES });
        return { status: "connected", device: { id: this.peer.id, name: this.peer.name, location: this.peer.location }, ...normalizeSkillCatalog(JSON.parse(stdout)), transport: transport.type };
      } catch { this.logger.warn?.(`[codex-control-console] peer ${this.peer.id} Skill catalog unavailable`); }
    }
    return { status: "error", device: { id: this.peer.id, name: this.peer.name, location: this.peer.location }, schemaVersion: SKILL_SCHEMA_VERSION, skills: [], message: `${this.peer.name} 暂时不可达。` };
  }

  async export(scope, name, sourceId = scope) {
    ({ scope, sourceId, name } = normalizeSkillLocator({ scope, sourceId, name }));
    for (const transport of this.peer.transports) {
      try {
        const { stdout } = await this.execFile("ssh", sshSkillContentArguments(transport, scope, name, sourceId, { remotePlatform: this.peer.platform }), { encoding: "utf8", timeout: PROCESS_TIMEOUT_MS, maxBuffer: MAX_PACKAGE_BYTES });
        return serializeSkillPackage(normalizeSkillPackage(JSON.parse(stdout)));
      } catch { this.logger.warn?.(`[codex-control-console] peer ${this.peer.id} Skill export unavailable`); }
    }
    const error = new Error(`${this.peer.name} 暂时不可达，无法读取 Skill。`);
    error.statusCode = 503;
    throw error;
  }

  async install(package_, expectedCurrentHash) {
    const skill = serializeSkillPackage(normalizeSkillPackage(package_));
    expectedCurrentHash = normalizeSkillHash(expectedCurrentHash, { nullable: true });
    const key = await loadActionKey(this.actionKeyPath);
    const timestamp = String(Date.now());
    const nonce = crypto.randomUUID();
    const body = Buffer.from(JSON.stringify({ package: skill, expectedCurrentHash, requestId: nonce }), "utf8");
    const headers = { [ACTION_HEADERS.timestamp]: timestamp, [ACTION_HEADERS.nonce]: nonce };
    headers[ACTION_HEADERS.signature] = signPeerAction(key, { method: "POST", path: SKILL_INSTALL_ACTION_PATH, timestamp, nonce, body });
    for (const transport of this.peer.transports) {
      try {
        const payload = JSON.parse(await executeAction(this.spawn, sshActionArguments(transport, headers, SKILL_INSTALL_ACTION_PATH, { remotePlatform: this.peer.platform }), body));
        if (payload.status !== "ok" || !payload.accepted) {
          const rejected = new Error(payload.message || "所属节点拒绝了 Skill 安装");
          rejected.remoteRejected = true;
          rejected.statusCode = 409;
          throw rejected;
        }
        return { accepted: true, unchanged: Boolean(payload.unchanged), backupCreated: Boolean(payload.backupCreated), hash: normalizeSkillHash(payload.hash || skill.hash), transport: transport.type };
      } catch (error) {
        if (error.remoteRejected) throw error;
        this.logger.warn?.(`[codex-control-console] peer ${this.peer.id} Skill install transport ${transport.type} unavailable`);
      }
    }
    const error = new Error(`${this.peer.name} 暂时不可达，Skill 未同步。`);
    error.statusCode = 503;
    throw error;
  }

  async toggle(input = {}) {
    const locator = normalizeSkillLocator(input);
    if (typeof input.enabled !== "boolean") throw new Error("Skill 开关状态无效");
    const key = await loadActionKey(this.actionKeyPath);
    const timestamp = String(Date.now());
    const nonce = crypto.randomUUID();
    const body = Buffer.from(JSON.stringify({ ...locator, enabled: input.enabled, requestId: nonce }), "utf8");
    const headers = { [ACTION_HEADERS.timestamp]: timestamp, [ACTION_HEADERS.nonce]: nonce };
    headers[ACTION_HEADERS.signature] = signPeerAction(key, { method: "POST", path: SKILL_TOGGLE_ACTION_PATH, timestamp, nonce, body });
    for (const transport of this.peer.transports) {
      try {
        const payload = JSON.parse(await executeAction(this.spawn, sshActionArguments(transport, headers, SKILL_TOGGLE_ACTION_PATH, { remotePlatform: this.peer.platform }), body));
        const accepted = payload.accepted === true || !Object.hasOwn(payload, "accepted");
        if (payload.status !== "ok" || !accepted || typeof payload.enabled !== "boolean") {
          const rejected = new Error(payload.message || "所属节点拒绝了 Skill 开关变更");
          rejected.remoteRejected = true;
          rejected.statusCode = 409;
          throw rejected;
        }
        return { enabled: payload.enabled, restartRequired: payload.restartRequired !== false, transport: transport.type };
      } catch (error) {
        if (error.remoteRejected) throw error;
        this.logger.warn?.(`[codex-control-console] peer ${this.peer.id} Skill toggle transport ${transport.type} unavailable`);
      }
    }
    const error = new Error(`${this.peer.name} 暂时不可达，Skill 开关未更改。`);
    error.statusCode = 503;
    throw error;
  }
}
