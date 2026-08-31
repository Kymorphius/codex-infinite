import { normalizePendingApprovals } from "./approval-contract.mjs";
import {
  executionDetailBytes,
  limitExecutionEntryDetail,
  MAX_ACTIVITY_PAYLOAD_BYTES,
  MAX_EXECUTION_TRANSCRIPT_BYTES,
  mergeExecutionResult,
  normalizePeerExecutionDetail,
  projectExecutionCall,
  projectExecutionResult
} from "./execution-transcript.mjs";
import { ACCESS_MODES, CONTEXT_OVERRIDE_STATES, normalizeServiceTier } from "./thread-settings.mjs";
import { EDITABLE_ACCESS_MODES, EDITABLE_SERVICE_TIERS } from "./thread-settings-control.mjs";

const MAX_ENTRIES = 60;
const MAX_TEXT_LENGTH = 4000;
const MAX_TOTAL_TEXT = 64 * 1024;
const TURN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TURN_STATES = new Set(["active", "completed", "interrupted", "unknown"]);
const TURN_STARTED_EVENTS = new Set(["task_started", "turn_started"]);
const TURN_COMPLETED_EVENTS = new Set(["task_complete", "task_completed", "turn_complete"]);
const TURN_INTERRUPTED_EVENTS = new Set(["turn_aborted", "task_aborted"]);
const MAX_CONTEXT_WINDOW = 2_000_000;

function cleanText(value, maxLength = MAX_TEXT_LENGTH) {
  return String(value || "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, maxLength);
}

function optionalSetting(value, maxLength, field) {
  if (value == null) return null;
  if (typeof value !== "string" || value.length > maxLength) throw new Error(`Peer activity ${field} is invalid`);
  return cleanText(value, maxLength) || null;
}

export function normalizePeerSessionSettings(payload) {
  const accessMode = payload.accessMode == null ? "unknown" : payload.accessMode;
  const contextOverrideState = payload.contextOverrideState == null ? "unknown" : payload.contextOverrideState;
  const requestedContextWindow = payload.requestedContextWindow == null ? null : payload.requestedContextWindow;
  const modelContextWindow = payload.modelContextWindow == null ? null : payload.modelContextWindow;
  const serviceTier = payload.serviceTier == null ? null : normalizeServiceTier(payload.serviceTier);
  if (payload.serviceTier != null && !serviceTier) throw new Error("Peer activity service tier is invalid");
  if (!ACCESS_MODES.includes(accessMode)) throw new Error("Peer activity access mode is invalid");
  if (!CONTEXT_OVERRIDE_STATES.includes(contextOverrideState)) throw new Error("Peer activity context state is invalid");
  if (contextOverrideState === "extended" && (!Number.isSafeInteger(requestedContextWindow) || requestedContextWindow < 32_000 || requestedContextWindow > MAX_CONTEXT_WINDOW)) {
    throw new Error("Peer activity context window is invalid");
  }
  if (contextOverrideState !== "extended" && requestedContextWindow !== null) throw new Error("Peer activity context window is invalid");
  if (modelContextWindow !== null && (!Number.isSafeInteger(modelContextWindow) || modelContextWindow < 1 || modelContextWindow > MAX_CONTEXT_WINDOW)) {
    throw new Error("Peer activity observed context window is invalid");
  }
  return Object.freeze({
    model: optionalSetting(payload.model, 120, "model"),
    reasoningEffort: optionalSetting(payload.reasoningEffort, 40, "reasoning effort"),
    serviceTier,
    approvalPolicy: optionalSetting(payload.approvalPolicy, 40, "approval policy"),
    permissionProfile: optionalSetting(payload.permissionProfile, 80, "permission profile"),
    accessMode,
    contextOverrideState,
    requestedContextWindow,
    modelContextWindow
  });
}

function strictOptionText(value, maxLength, field, { nullable = false } = {}) {
  if (nullable && value == null) return null;
  if (typeof value !== "string" || !value.trim() || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`Peer activity ${field} is invalid`);
  }
  return value.trim();
}

export function normalizePeerSettingsOptions(payload) {
  if (payload == null) return null;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Peer activity settings options are invalid");
  if (!Array.isArray(payload.models) || payload.models.length > 16) throw new Error("Peer activity model options are invalid");
  const modelIds = new Set();
  const models = payload.models.map((model) => {
    if (!model || typeof model !== "object" || Array.isArray(model) || !Array.isArray(model.reasoningEfforts) || model.reasoningEfforts.length > 8) {
      throw new Error("Peer activity model option is invalid");
    }
    if (model.serviceTiers != null && (!Array.isArray(model.serviceTiers) || model.serviceTiers.length > 4)) throw new Error("Peer activity service tier options are invalid");
    const id = strictOptionText(model.id, 120, "model option id");
    if (modelIds.has(id)) throw new Error("Peer activity model options are invalid");
    modelIds.add(id);
    const effortIds = new Set();
    const reasoningEfforts = model.reasoningEfforts.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Peer activity reasoning option is invalid");
      const effort = strictOptionText(item.effort, 40, "reasoning option");
      if (effortIds.has(effort)) throw new Error("Peer activity reasoning options are invalid");
      effortIds.add(effort);
      return Object.freeze({ effort, description: strictOptionText(item.description, 180, "reasoning description", { nullable: true }) });
    });
    const defaultReasoningEffort = strictOptionText(model.defaultReasoningEffort, 40, "default reasoning effort", { nullable: true });
    if (defaultReasoningEffort && !effortIds.has(defaultReasoningEffort)) throw new Error("Peer activity default reasoning effort is invalid");
    const tierIds = new Set();
    const serviceTiers = (model.serviceTiers || []).map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Peer activity service tier option is invalid");
      const tierId = strictOptionText(item.id, 40, "service tier option");
      if (!EDITABLE_SERVICE_TIERS.includes(tierId) || tierIds.has(tierId)) throw new Error("Peer activity service tier options are invalid");
      tierIds.add(tierId);
      return Object.freeze({
        id: tierId,
        name: strictOptionText(item.name, 80, "service tier name"),
        description: strictOptionText(item.description, 180, "service tier description", { nullable: true })
      });
    });
    if (serviceTiers.length && !tierIds.has("default")) throw new Error("Peer activity standard service tier is missing");
    return Object.freeze({
      id,
      displayName: strictOptionText(model.displayName, 120, "model display name"),
      description: strictOptionText(model.description, 240, "model description", { nullable: true }),
      defaultReasoningEffort,
      reasoningEfforts: Object.freeze(reasoningEfforts),
      serviceTiers: Object.freeze(serviceTiers)
    });
  });
  if (!Array.isArray(payload.accessModes) || !payload.accessModes.length || payload.accessModes.length > EDITABLE_ACCESS_MODES.length) {
    throw new Error("Peer activity access options are invalid");
  }
  const accessModes = payload.accessModes.map((mode) => {
    if (!EDITABLE_ACCESS_MODES.includes(mode)) throw new Error("Peer activity access option is invalid");
    return mode;
  });
  if (new Set(accessModes).size !== accessModes.length) throw new Error("Peer activity access options are invalid");
  if (!Number.isSafeInteger(payload.contextWindow) || payload.contextWindow < 32_000 || payload.contextWindow > MAX_CONTEXT_WINDOW) {
    throw new Error("Peer activity extended context option is invalid");
  }
  return Object.freeze({ models: Object.freeze(models), accessModes: Object.freeze(accessModes), contextWindow: payload.contextWindow });
}

function messageText(content) {
  if (!Array.isArray(content)) return "";
  return cleanText(content.filter((item) => ["input_text", "output_text"].includes(item?.type)).map((item) => item.text || "").join("\n"));
}

function recordTurnId(payload) {
  const candidate = cleanText(
    payload?.turn_id
      || payload?.item?.turn_id
      || payload?.internal_chat_message_metadata_passthrough?.turn_id,
    160
  ).toLowerCase();
  return TURN_ID_PATTERN.test(candidate) ? candidate : null;
}

export function parseConversationActivity(content, { threadId = "", maxEntries = MAX_ENTRIES } = {}) {
  const entries = [];
  const calls = new Map();
  let sequence = 0;
  let turnId = null;
  let turnState = "unknown";
  for (const line of String(content).split(/\r?\n/)) {
    if (!line.trim()) continue;
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    const payload = record?.payload;
    if (!payload) continue;
    const candidateTurnId = recordTurnId(payload);
    if (candidateTurnId && candidateTurnId !== turnId) {
      turnId = candidateTurnId;
      turnState = "active";
    } else if (candidateTurnId && turnState === "unknown") {
      turnState = "active";
    }
    let entry = null;
    let executionCall = null;
    let executionResult = null;
    if (record.type === "response_item" && payload.type === "message" && ["user", "assistant"].includes(payload.role)) {
      const text = messageText(payload.content);
      if (text) entry = { kind: "message", role: payload.role, phase: cleanText(payload.phase, 32) || null, text };
    } else if (record.type === "response_item" && (executionCall = projectExecutionCall(payload))) {
      entry = { ...executionCall, kind: "tool", name: cleanText(executionCall.name, 120), status: cleanText(executionCall.status, 32) || "requested" };
    } else if (record.type === "response_item" && (executionResult = projectExecutionResult(payload))) {
      const result = executionResult;
      const callIndex = result.callId == null ? null : calls.get(result.callId);
      if (callIndex != null) entries[callIndex] = mergeExecutionResult(entries[callIndex], result);
      else {
        entries.push(Object.freeze({
          id: result.id || result.callId || `${sequence}`,
          timestamp: cleanText(record.timestamp, 64) || null,
          kind: "tool",
          name: "tool-result",
          status: "completed",
          callId: result.callId,
          input: null,
          output: result.output,
          inputTruncated: false,
          outputTruncated: result.outputTruncated
        }));
        sequence += 1;
      }
      continue;
    } else if (record.type === "event_msg" && (TURN_STARTED_EVENTS.has(payload.type) || TURN_COMPLETED_EVENTS.has(payload.type) || TURN_INTERRUPTED_EVENTS.has(payload.type))) {
      const lifecycle = TURN_STARTED_EVENTS.has(payload.type) ? "started" : TURN_COMPLETED_EVENTS.has(payload.type) ? "completed" : "interrupted";
      entry = { kind: "status", status: lifecycle };
      turnId = candidateTurnId || turnId;
      turnState = lifecycle === "started" ? "active" : lifecycle;
    }
    if (!entry) continue;
    entries.push(Object.freeze({ ...entry, id: cleanText(payload.id || payload.call_id, 160) || `${sequence}`, timestamp: cleanText(record.timestamp, 64) || null }));
    if (entry.kind === "tool" && entry.callId) calls.set(entry.callId, entries.length - 1);
    sequence += 1;
  }
  let remainingText = MAX_TOTAL_TEXT;
  let remainingExecution = MAX_EXECUTION_TRANSCRIPT_BYTES;
  const selected = [];
  for (const original of entries.slice(-Math.min(MAX_ENTRIES, Math.max(1, maxEntries))).reverse()) {
    if (original.kind === "tool") {
      const limited = limitExecutionEntryDetail(original, remainingExecution);
      remainingExecution -= Math.min(remainingExecution, executionDetailBytes(limited));
      selected.push(limited);
    } else if (!original.text) selected.push(original);
    else if (remainingText > 0) {
      const text = original.text.slice(-remainingText);
      remainingText -= text.length;
      selected.push(Object.freeze({ ...original, text }));
    }
  }
  return Object.freeze({ schemaVersion: 1, threadId: cleanText(threadId, 160), turnId, turnState, entries: Object.freeze(selected.reverse()) });
}

export function normalizePeerActivity(peer, payload = {}) {
  if (payload.schemaVersion !== 1 || !Array.isArray(payload.entries) || payload.entries.length > MAX_ENTRIES) throw new Error("Peer activity contract is invalid");
  if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > MAX_ACTIVITY_PAYLOAD_BYTES) throw new Error("Peer activity response is too large");
  let totalText = 0;
  let totalExecution = 0;
  const entries = payload.entries.map((entry) => {
    const base = { id: cleanText(entry?.id, 160), timestamp: cleanText(entry?.timestamp, 64) || null };
    if (entry?.kind === "message" && ["user", "assistant"].includes(entry.role) && typeof entry.text === "string") {
      const text = cleanText(entry.text);
      totalText += text.length;
      if (totalText > MAX_TOTAL_TEXT) throw new Error("Peer activity text is too large");
      return Object.freeze({ ...base, kind: "message", role: entry.role, phase: cleanText(entry.phase, 32) || null, text });
    }
    if (entry?.kind === "tool" && typeof entry.name === "string") {
      const detail = normalizePeerExecutionDetail(entry);
      totalExecution += detail.bytes;
      if (totalExecution > MAX_EXECUTION_TRANSCRIPT_BYTES) throw new Error("Peer execution transcript is too large");
      return Object.freeze({
        ...base,
        kind: "tool",
        name: cleanText(entry.name, 120),
        status: cleanText(entry.status, 32) || "requested",
        callId: detail.callId,
        input: detail.input,
        output: detail.output,
        inputTruncated: detail.inputTruncated,
        outputTruncated: detail.outputTruncated
      });
    }
    if (entry?.kind === "status" && ["started", "completed", "interrupted"].includes(entry.status)) return Object.freeze({ ...base, kind: "status", status: entry.status });
    throw new Error("Peer activity entry is invalid");
  });
  let draft = null;
  if (payload.draft != null) {
    if (typeof payload.draft?.text !== "string" || payload.draft.text.length > 12_000 || !/^[0-9a-f]{64}$/.test(String(payload.draft.revision || ""))) {
      throw new Error("Peer activity draft is invalid");
    }
    draft = Object.freeze({ text: cleanText(payload.draft.text, 12_000), revision: payload.draft.revision });
  }
  const turnId = payload.turnId == null ? null : cleanText(payload.turnId, 160).toLowerCase();
  const turnState = payload.turnState == null ? "unknown" : cleanText(payload.turnState, 32);
  if (turnId !== null && !TURN_ID_PATTERN.test(turnId)) throw new Error("Peer activity turn id is invalid");
  if (!TURN_STATES.has(turnState)) throw new Error("Peer activity turn state is invalid");
  const threadId = cleanText(payload.threadId, 160);
  const approvals = normalizePendingApprovals(payload.approvals || [], { expectedThreadId: threadId });
  const sessionSettings = normalizePeerSessionSettings(payload);
  const settingsOptions = normalizePeerSettingsOptions(payload.settingsOptions);
  return Object.freeze({
    schemaVersion: 1,
    threadId,
    turnId,
    turnState,
    title: cleanText(payload.title, 160) || null,
    updatedAt: cleanText(payload.updatedAt, 64) || null,
    entries: Object.freeze(entries),
    draft,
    approvals,
    settingsOptions,
    ...sessionSettings,
    device: Object.freeze({ id: peer.id, name: peer.name, kind: "remote-codex", location: peer.location, status: "connected" })
  });
}
