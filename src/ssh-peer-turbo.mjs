import crypto from "node:crypto";
import { ACTION_HEADERS, loadActionKey, signPeerAction } from "./peer-action-auth.mjs";
import { TURBO_ACTION_PATH, sshActionArguments } from "./ssh-peer-commands.mjs";
import { TURBO_POLICY_FIELDS, validateTurboChange } from "./turbo-control.mjs";

function peerError(code, message) {
  return Object.assign(new Error(message), { code, statusCode: 502 });
}

function readAcknowledgement(raw) {
  let payload;
  try { payload = JSON.parse(raw); }
  catch { throw peerError("TURBO_PEER_RESPONSE_INVALID", "所属节点的 Turbo 确认无效"); }
  if (payload?.status === "error" && payload.code === "TURBO_PEER_BUSY") {
    throw peerError("TURBO_PEER_BUSY", "所属节点正在保存或同步 Turbo 设置，请稍后重试");
  }
  if (!payload || payload.status !== "ok" || payload.accepted !== true) {
    throw peerError("TURBO_PEER_REJECTED", "所属节点拒绝了 Turbo 设置");
  }
  try {
    if (!TURBO_POLICY_FIELDS.every((key) => Object.hasOwn(payload, key))) throw new Error("Incomplete policy");
    return validateTurboChange(Object.fromEntries(TURBO_POLICY_FIELDS.map((key) => [key, payload[key]])), { allowRequestId: false });
  } catch {
    throw peerError("TURBO_PEER_RESPONSE_INVALID", "所属节点的 Turbo 确认不完整或无效");
  }
}

export async function updatePeerTurbo(adapter, executeAction, change) {
  const { peer, actionKeyPath, spawn, logger } = adapter;
  change = validateTurboChange(typeof change === "boolean" ? { enabled: change } : change, { allowRequestId: false });
  const key = await loadActionKey(actionKeyPath);
  const timestamp = String(Date.now());
  const nonce = crypto.randomUUID();
  const body = Buffer.from(JSON.stringify({ ...change, requestId: nonce }), "utf8");
  const headers = { [ACTION_HEADERS.timestamp]: timestamp, [ACTION_HEADERS.nonce]: nonce };
  headers[ACTION_HEADERS.signature] = signPeerAction(key, { method: "POST", path: TURBO_ACTION_PATH, timestamp, nonce, body });
  for (const transport of peer.transports) {
    try {
      const raw = await executeAction(spawn, sshActionArguments(transport, headers, TURBO_ACTION_PATH, { remotePlatform: peer.platform }), body);
      return { accepted: true, ...readAcknowledgement(raw), transport: transport.type };
    } catch (error) {
      if (error.code?.startsWith("TURBO_PEER_")) throw error;
      logger.warn?.(`[codex-control-console] peer ${peer.id} turbo transport ${transport.type} unavailable`);
    }
  }
  throw Object.assign(peerError("TURBO_PEER_UNREACHABLE", "所属节点暂时不可达，Turbo 设置未同步"), { statusCode: 503 });
}
