const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const APPROVAL_KINDS = new Set(["command", "writeStdin", "fileChange", "permissions"]);
const APPROVAL_DECISIONS = new Set(["accept", "decline"]);

export const MAX_PENDING_APPROVALS = 8;

function requiredText(value, name, maxLength) {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) throw new Error(`Peer approval ${name} is invalid`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new Error(`Peer approval ${name} is invalid`);
  return value.trim();
}

function optionalText(value, name, maxLength) {
  if (value == null || value === "") return null;
  return requiredText(value, name, maxLength);
}

function uuid(value, name) {
  const normalized = requiredText(value, name, 36).toLowerCase();
  if (!UUID_PATTERN.test(normalized)) throw new Error(`Peer approval ${name} is invalid`);
  return normalized;
}

export function normalizeApprovalProjection(input, { expectedThreadId = null } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Peer approval is invalid");
  const token = uuid(input.token, "token");
  const threadId = uuid(input.threadId, "thread id");
  const turnId = uuid(input.turnId, "turn id");
  if (expectedThreadId && threadId !== String(expectedThreadId).toLowerCase()) throw new Error("Peer approval belongs to another thread");
  const kind = requiredText(input.kind, "kind", 32);
  if (!APPROVAL_KINDS.has(kind)) throw new Error("Peer approval kind is invalid");
  if (!Number.isSafeInteger(input.startedAtMs) || input.startedAtMs < 0) throw new Error("Peer approval start time is invalid");
  if (!Array.isArray(input.decisions) || input.decisions.length < 1 || input.decisions.length > APPROVAL_DECISIONS.size) {
    throw new Error("Peer approval decisions are invalid");
  }
  const decisions = [...new Set(input.decisions.map((decision) => requiredText(decision, "decision", 16)))];
  if (decisions.length !== input.decisions.length || decisions.some((decision) => !APPROVAL_DECISIONS.has(decision))) {
    throw new Error("Peer approval decisions are invalid");
  }
  if (!Array.isArray(input.permissionSummary) || input.permissionSummary.length > 12) throw new Error("Peer approval permissions are invalid");
  const permissionSummary = input.permissionSummary.map((summary) => requiredText(summary, "permission", 400));
  return Object.freeze({
    token,
    kind,
    threadId,
    turnId,
    itemId: requiredText(input.itemId, "item id", 160),
    startedAtMs: input.startedAtMs,
    reason: optionalText(input.reason, "reason", 2_000),
    command: optionalText(input.command, "command", 4_000),
    cwd: optionalText(input.cwd, "working directory", 1_000),
    networkHost: optionalText(input.networkHost, "network host", 512),
    permissionSummary: Object.freeze(permissionSummary),
    decisions: Object.freeze(decisions)
  });
}

export function normalizePendingApprovals(items, { expectedThreadId = null } = {}) {
  if (!Array.isArray(items) || items.length > MAX_PENDING_APPROVALS) throw new Error("Peer approvals contract is invalid");
  const normalized = items.map((item) => normalizeApprovalProjection(item, { expectedThreadId }));
  if (new Set(normalized.map((item) => item.token)).size !== normalized.length) throw new Error("Peer approval token is duplicated");
  return Object.freeze(normalized);
}

export function validateApprovalDecision(value) {
  const decision = String(value || "").trim();
  if (!APPROVAL_DECISIONS.has(decision)) throw new Error("Approval decision is invalid");
  return decision;
}

