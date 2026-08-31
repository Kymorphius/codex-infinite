import { normalizeNodeRuntime, unknownNodeRuntime } from "./node-runtime.mjs";
import { ACCESS_MODES, CONTEXT_OVERRIDE_STATES, SERVICE_TIERS } from "./thread-settings.mjs";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const NODE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const USER_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]{0,31}$/;
const HOST_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
const MAX_PEER_TASKS = 200;
const MAX_CONTEXT_WINDOW = 2_000_000;

function text(value, maxLength, fallback = "") {
  const normalized = String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (normalized || fallback).slice(0, maxLength);
}

function port(value, fallback) {
  const parsed = Number.parseInt(value ?? fallback, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) throw new Error("Peer port is invalid");
  return parsed;
}

function host(value, field) {
  const normalized = text(value, 253);
  if (!HOST_PATTERN.test(normalized) || normalized.includes("..")) throw new Error(`${field} is invalid`);
  return normalized;
}

function user(value, field) {
  const normalized = text(value, 32);
  if (!USER_PATTERN.test(normalized)) throw new Error(`${field} is invalid`);
  return normalized;
}

export function normalizePeerTransport(input = {}) {
  if (input.type === "direct-ssh") {
    return Object.freeze({
      type: "direct-ssh",
      host: host(input.host, "Peer host"),
      user: user(input.user, "Peer user"),
      port: port(input.port, 22),
      dashboardPort: port(input.dashboardPort, 47831)
    });
  }
  if (input.type === "ssh-relay") {
    return Object.freeze({
      type: "ssh-relay",
      relayHost: host(input.relayHost, "Relay host"),
      relayUser: user(input.relayUser, "Relay user"),
      relayPort: port(input.relayPort, 22),
      forwardedPort: port(input.forwardedPort)
    });
  }
  throw new Error("Peer transport type is unsupported");
}

export function normalizePeerDefinition(input = {}) {
  const id = text(input.id, 64);
  if (!NODE_ID_PATTERN.test(id)) throw new Error("Peer id is invalid");
  const transports = Array.isArray(input.transports) ? input.transports : [];
  if (transports.length < 1 || transports.length > 4) throw new Error("Peer transports must contain 1 to 4 entries");
  return Object.freeze({
    id,
    name: text(input.name, 80, id),
    location: text(input.location, 80, "远程"),
    transports: Object.freeze(transports.map(normalizePeerTransport))
  });
}

function publicTask(task, device) {
  const id = text(task?.id, 160);
  if (!ID_PATTERN.test(id)) return null;
  return Object.freeze({
    id,
    title: text(task?.title, 160, `任务 ${id.slice(0, 8)}`),
    status: text(task?.status, 24, "unknown"),
    cwd: text(task?.cwd, 1024) || null,
    createdAt: text(task?.createdAt, 64) || null,
    updatedAt: text(task?.updatedAt, 64) || null,
    recordCount: Number.isSafeInteger(task?.recordCount) && task.recordCount >= 0 ? task.recordCount : 0,
    model: text(task?.model, 120) || null,
    reasoningEffort: text(task?.reasoningEffort, 40) || null,
    serviceTier: SERVICE_TIERS.includes(task?.serviceTier) && task.serviceTier !== "unknown" ? task.serviceTier : null,
    approvalPolicy: text(task?.approvalPolicy, 40) || null,
    permissionProfile: text(task?.permissionProfile, 80) || null,
    accessMode: ACCESS_MODES.includes(task?.accessMode) ? task.accessMode : "unknown",
    contextOverrideState: CONTEXT_OVERRIDE_STATES.includes(task?.contextOverrideState) ? task.contextOverrideState : "unknown",
    requestedContextWindow: Number.isSafeInteger(task?.requestedContextWindow) && task.requestedContextWindow > 0 && task.requestedContextWindow <= MAX_CONTEXT_WINDOW ? task.requestedContextWindow : null,
    modelContextWindow: Number.isSafeInteger(task?.modelContextWindow) && task.modelContextWindow > 0 ? task.modelContextWindow : null,
    project: text(task?.project, 160, "未归类"),
    boardStatus: text(task?.boardStatus, 24, "pending"),
    device
  });
}

export function projectLocalNodeSnapshot(result = {}, runtime = unknownNodeRuntime()) {
  const node = result.devices?.[0] || {};
  const device = Object.freeze({
    id: text(node.id, 64, "local"),
    name: text(node.name, 80, "本机"),
    kind: "local-codex",
    location: text(node.location, 80, "本机"),
    status: text(node.status, 24, "connected"),
    runtime: normalizeNodeRuntime(runtime)
  });
  return Object.freeze({
    schemaVersion: 3,
    status: ["connected", "empty", "disconnected", "error"].includes(result.status) ? result.status : "error",
    node: device,
    tasks: Object.freeze((Array.isArray(result.tasks) ? result.tasks : []).slice(0, MAX_PEER_TASKS).map((task) => publicTask(task, device)).filter(Boolean))
  });
}

export function normalizePeerSnapshot(peer, payload = {}) {
  if (![1, 2, 3].includes(payload.schemaVersion) || !Array.isArray(payload.tasks) || payload.tasks.length > MAX_PEER_TASKS) {
    throw new Error("Peer snapshot contract is invalid");
  }
  if (payload.schemaVersion === 3 && payload.tasks.some((task) => (
    !ACCESS_MODES.includes(task?.accessMode)
    || (task.serviceTier != null && (!SERVICE_TIERS.includes(task.serviceTier) || task.serviceTier === "unknown"))
    || !CONTEXT_OVERRIDE_STATES.includes(task?.contextOverrideState)
    || (task.contextOverrideState === "extended" && (!Number.isSafeInteger(task.requestedContextWindow) || task.requestedContextWindow < 32_000 || task.requestedContextWindow > MAX_CONTEXT_WINDOW))
    || (task.contextOverrideState !== "extended" && task.requestedContextWindow != null)
  ))) throw new Error("Peer snapshot settings are invalid");
  const runtime = payload.schemaVersion >= 2 ? normalizeNodeRuntime(payload.node?.runtime) : unknownNodeRuntime();
  const device = Object.freeze({ id: peer.id, name: peer.name, kind: "remote-codex", location: peer.location, status: "connected", runtime });
  const tasks = payload.tasks.map((task) => publicTask(task, device));
  if (tasks.some((task) => !task)) throw new Error("Peer snapshot contains an invalid task");
  return Object.freeze({
    status: tasks.length ? "connected" : "empty",
    source: "federated-peer-snapshot",
    readOnly: true,
    tasks: Object.freeze(tasks),
    devices: Object.freeze([device])
  });
}
