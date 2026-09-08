import { execFile as nodeExecFile } from "node:child_process";
import { spawn as nodeSpawn } from "node:child_process";
import crypto from "node:crypto";
import { promisify } from "node:util";
import { normalizePeerSnapshot } from "./peer-contract.mjs";
import { normalizePeerActivity, normalizePeerSessionSettings, normalizePeerSettingsOptions } from "./conversation-activity.mjs";
import { ACTION_HEADERS, loadActionKey, signPeerAction } from "./peer-action-auth.mjs";
import { validateThreadSettingsTransport } from "./thread-settings-control.mjs";
import { SshPeerSkills } from "./ssh-peer-skills.mjs";
import { CONTROL_ACTION_PATH, DRAFT_ACTION_PATH, MESSAGE_ACTION_PATH, SETTINGS_ACTION_PATH, TURBO_ACTION_PATH, sshActionArguments, sshActivityArguments, sshSnapshotArguments } from "./ssh-peer-commands.mjs";

export { sshActionArguments, sshActivityArguments, sshSkillContentArguments, sshSkillsArguments, sshSnapshotArguments } from "./ssh-peer-commands.mjs";

const execFile = promisify(nodeExecFile);
const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024;
const MAX_ACTIVITY_BYTES = 2 * 1024 * 1024;
const THREAD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/;
const SNAPSHOT_PROCESS_TIMEOUT_MS = 32_000;
const ACTIVITY_PROCESS_TIMEOUT_MS = 20_000;

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
  constructor({ peer, actionKeyPath = null, execFileImpl = execFile, spawnImpl = nodeSpawn, logger = console, clock = () => Date.now(), backoffBaseMs = 5_000, backoffMaxMs = 60_000 } = {}) {
    this.peer = peer;
    this.execFile = execFileImpl;
    this.spawn = spawnImpl;
    this.actionKeyPath = actionKeyPath;
    this.logger = logger;
    this.clock = clock;
    this.backoffBaseMs = backoffBaseMs;
    this.backoffMaxMs = backoffMaxMs;
    this.readFailures = 0;
    this.nextReadAt = 0;
    this.snapshotRequest = null;
    this.lastSnapshot = null;
    this.skills = new SshPeerSkills({ peer, execFile: execFileImpl, spawn: spawnImpl, actionKeyPath, logger });
  }
  unavailableSnapshot() {
    const device = Object.freeze({ id: this.peer.id, name: this.peer.name, kind: "remote-codex", location: this.peer.location, status: "error" });
    return { status: "error", source: "federated-peer-snapshot", readOnly: true, tasks: [], devices: [device], message: `${this.peer.name} 暂时不可达。` };
  }
  registerReadFailure() {
    this.readFailures += 1;
    const delay = Math.min(this.backoffMaxMs, this.backoffBaseMs * (2 ** (this.readFailures - 1)));
    this.nextReadAt = this.clock() + delay;
  }
  registerReadSuccess() {
    this.readFailures = 0;
    this.nextReadAt = 0;
  }

  listTasks() {
    if (this.nextReadAt > this.clock()) return Promise.resolve(this.lastSnapshot || this.unavailableSnapshot());
    if (this.snapshotRequest) return this.snapshotRequest;
    this.snapshotRequest = this.fetchSnapshot().finally(() => { this.snapshotRequest = null; });
    return this.snapshotRequest;
  }

  async fetchSnapshot() {
    for (const transport of this.peer.transports) {
      try {
        const { stdout } = await this.execFile("ssh", sshSnapshotArguments(transport, { remotePlatform: this.peer.platform }), {
          encoding: "utf8",
          timeout: SNAPSHOT_PROCESS_TIMEOUT_MS,
          maxBuffer: MAX_SNAPSHOT_BYTES
        });
        const result = normalizePeerSnapshot(this.peer, JSON.parse(stdout));
        this.registerReadSuccess();
        this.lastSnapshot = { ...result, transport: transport.type };
        return this.lastSnapshot;
      } catch (error) {
        this.logger.warn?.(`[codex-control-console] peer ${this.peer.id} transport ${transport.type} unavailable`);
      }
    }
    this.registerReadFailure();
    this.lastSnapshot = this.unavailableSnapshot();
    return this.lastSnapshot;
  }

  async getActivity(threadId) {
    if (!THREAD_ID_PATTERN.test(String(threadId || ""))) throw new Error("Peer activity thread id is invalid");
    if (this.nextReadAt > this.clock()) {
      const error = new Error(`${this.peer.name} 暂时不可达。`);
      error.statusCode = 503;
      throw error;
    }
    for (const transport of this.peer.transports) {
      try {
        const { stdout } = await this.execFile("ssh", sshActivityArguments(transport, threadId, { remotePlatform: this.peer.platform }), {
          encoding: "utf8",
          timeout: ACTIVITY_PROCESS_TIMEOUT_MS,
          maxBuffer: MAX_ACTIVITY_BYTES
        });
        this.registerReadSuccess();
        return { ...normalizePeerActivity(this.peer, JSON.parse(stdout)), transport: transport.type };
      } catch {
        this.logger.warn?.(`[codex-control-console] peer ${this.peer.id} activity transport ${transport.type} unavailable`);
      }
    }
    this.registerReadFailure();
    const error = new Error(`${this.peer.name} 暂时不可达。`);
    error.statusCode = 503;
    throw error;
  }

  async listSkills() { return this.skills.list(); }
  async exportSkill(scope, name, sourceId = scope) { return this.skills.export(scope, name, sourceId); }
  async installSkill(package_, expectedCurrentHash) { return this.skills.install(package_, expectedCurrentHash); }
  async toggleSkill(input) { return this.skills.toggle(input); }

  async sendMessage(threadId, prompt, expectedDraftRevision = null, deliveryMode = "new-turn") {
    if (!THREAD_ID_PATTERN.test(String(threadId || ""))) throw new Error("Peer action thread id is invalid");
    if (!["new-turn", "queue", "steer"].includes(deliveryMode)) throw new Error("Peer message delivery mode is invalid");
    const key = await loadActionKey(this.actionKeyPath);
    const timestamp = String(Date.now());
    const nonce = crypto.randomUUID();
    const body = Buffer.from(JSON.stringify({ threadId, prompt, expectedDraftRevision, deliveryMode, requestId: nonce }), "utf8");
    const headers = {
      [ACTION_HEADERS.timestamp]: timestamp,
      [ACTION_HEADERS.nonce]: nonce
    };
    headers[ACTION_HEADERS.signature] = signPeerAction(key, { method: "POST", path: MESSAGE_ACTION_PATH, timestamp, nonce, body });
    for (const transport of this.peer.transports) {
      try {
        const payload = JSON.parse(await executeAction(this.spawn, sshActionArguments(transport, headers, MESSAGE_ACTION_PATH, { remotePlatform: this.peer.platform }), body));
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
          deliveryMode: ["new-turn", "queue", "steer"].includes(payload.deliveryMode) ? payload.deliveryMode : deliveryMode,
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

  async updateDraft(threadId, text, expectedDraftRevision = null) {
    if (!THREAD_ID_PATTERN.test(String(threadId || ""))) throw new Error("Peer draft thread id is invalid");
    if (typeof text !== "string" || text.length > 12_000) throw new Error("Peer draft is invalid");
    if (expectedDraftRevision !== null && !/^[0-9a-f]{64}$/.test(String(expectedDraftRevision))) throw new Error("Peer draft revision is invalid");
    const key = await loadActionKey(this.actionKeyPath);
    const timestamp = String(Date.now());
    const nonce = crypto.randomUUID();
    const body = Buffer.from(JSON.stringify({ threadId, text, expectedDraftRevision, requestId: nonce }), "utf8");
    const headers = { [ACTION_HEADERS.timestamp]: timestamp, [ACTION_HEADERS.nonce]: nonce };
    headers[ACTION_HEADERS.signature] = signPeerAction(key, { method: "POST", path: DRAFT_ACTION_PATH, timestamp, nonce, body });
    for (const transport of this.peer.transports) {
      try {
        const payload = JSON.parse(await executeAction(this.spawn, sshActionArguments(transport, headers, DRAFT_ACTION_PATH, { remotePlatform: this.peer.platform }), body));
        if (payload.status !== "ok" || !payload.accepted) {
          const rejected = new Error(payload.message || "所属节点拒绝了草稿同步");
          rejected.remoteRejected = true;
          rejected.statusCode = 409;
          throw rejected;
        }
        const draft = payload.draft == null ? null : payload.draft;
        if (draft !== null && (typeof draft.text !== "string" || draft.text.length > 12_000 || !/^[0-9a-f]{64}$/.test(String(draft.revision || "")))) {
          const invalid = new Error("所属节点返回的草稿确认无效");
          invalid.remoteRejected = true;
          invalid.statusCode = 502;
          throw invalid;
        }
        return { accepted: true, draft, duplicate: Boolean(payload.duplicate), transport: transport.type };
      } catch (error) {
        if (error.remoteRejected) throw error;
        this.logger.warn?.(`[codex-control-console] peer ${this.peer.id} draft transport ${transport.type} unavailable`);
      }
    }
    const error = new Error(`${this.peer.name} 暂时不可达，草稿未同步。`);
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
        const payload = JSON.parse(await executeAction(this.spawn, sshActionArguments(transport, headers, CONTROL_ACTION_PATH, { remotePlatform: this.peer.platform }), body));
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
        const payload = JSON.parse(await executeAction(this.spawn, sshActionArguments(transport, headers, SETTINGS_ACTION_PATH, { remotePlatform: this.peer.platform }), body));
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

  async updateTurbo(change) {
    change = typeof change === "boolean" ? { enabled: change } : change;
    if (!change || typeof change !== "object" || Array.isArray(change)) throw new Error("Turbo setting is invalid");
    const keys = Object.keys(change);
    const allowed = ["enabled", "model", "reasoningEffort", "fast", "millionContext", "accessMode", "deviceIds"];
    if (!keys.length || keys.some((key) => !allowed.includes(key))) throw new Error("Turbo setting is invalid");
    if (Object.hasOwn(change, "enabled") && typeof change.enabled !== "boolean") throw new Error("Turbo switch is invalid");
    if (Object.hasOwn(change, "model") && change.model !== null && typeof change.model !== "string") throw new Error("Turbo model setting is invalid");
    if (Object.hasOwn(change, "reasoningEffort") && typeof change.reasoningEffort !== "string") throw new Error("Turbo reasoning setting is invalid");
    if (Object.hasOwn(change, "fast") && typeof change.fast !== "boolean") throw new Error("Turbo speed setting is invalid");
    if (Object.hasOwn(change, "millionContext") && typeof change.millionContext !== "boolean") throw new Error("Turbo context setting is invalid");
    if (Object.hasOwn(change, "accessMode") && typeof change.accessMode !== "string") throw new Error("Turbo access setting is invalid");
    if (Object.hasOwn(change, "deviceIds") && !Array.isArray(change.deviceIds)) throw new Error("Turbo device setting is invalid");
    const key = await loadActionKey(this.actionKeyPath);
    const timestamp = String(Date.now());
    const nonce = crypto.randomUUID();
    const body = Buffer.from(JSON.stringify({ ...change, requestId: nonce }), "utf8");
    const headers = { [ACTION_HEADERS.timestamp]: timestamp, [ACTION_HEADERS.nonce]: nonce };
    headers[ACTION_HEADERS.signature] = signPeerAction(key, { method: "POST", path: TURBO_ACTION_PATH, timestamp, nonce, body });
    for (const transport of this.peer.transports) {
      try {
        const payload = JSON.parse(await executeAction(this.spawn, sshActionArguments(transport, headers, TURBO_ACTION_PATH, { remotePlatform: this.peer.platform }), body));
        if (payload.status !== "ok" || !payload.accepted || typeof payload.enabled !== "boolean" || typeof payload.millionContext !== "boolean") throw new Error("所属节点拒绝了 Turbo 设置");
        return {
          accepted: true, enabled: payload.enabled, model: typeof payload.model === "string" ? payload.model : null,
          reasoningEffort: payload.reasoningEffort, fast: payload.fast !== false, millionContext: payload.millionContext,
          accessMode: payload.accessMode, deviceIds: Array.isArray(payload.deviceIds) ? payload.deviceIds : [], transport: transport.type
        };
      } catch {
        this.logger.warn?.(`[codex-control-console] peer ${this.peer.id} turbo transport ${transport.type} unavailable`);
      }
    }
    const error = new Error(`${this.peer.name} 暂时不可达，Turbo 设置未同步。`);
    error.statusCode = 503;
    throw error;
  }
}
