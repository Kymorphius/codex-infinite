const encoder = new TextEncoder();
const CALL_ID_PATTERN = /^[^\u0000-\u001f\u007f]{1,200}$/;
const CALL_TYPES = new Map([
  ["custom_tool_call", { input: "input" }],
  ["function_call", { input: "arguments" }],
  ["web_search_call", { input: "action" }]
]);
const RESULT_TYPES = new Set(["custom_tool_call_output", "function_call_output"]);

export const MAX_EXECUTION_FIELD_BYTES = 256 * 1024;
export const MAX_EXECUTION_TRANSCRIPT_BYTES = 1024 * 1024;
export const MAX_ACTIVITY_PAYLOAD_BYTES = 2 * 1024 * 1024;

function boundedId(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return CALL_ID_PATTERN.test(text) ? text : null;
}

function rawValue(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  try {
    const serialized = JSON.stringify(value, null, 2);
    return typeof serialized === "string" ? serialized : null;
  } catch {
    return null;
  }
}

function boundedUtf8(value, maxBytes) {
  if (value === null) return { text: null, truncated: false, bytes: 0 };
  const bytes = encoder.encode(value);
  if (bytes.byteLength <= maxBytes) return { text: value, truncated: false, bytes: bytes.byteLength };
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (encoder.encode(value.slice(0, middle)).byteLength <= maxBytes) low = middle;
    else high = middle - 1;
  }
  if (low > 0 && /[\uD800-\uDBFF]/.test(value[low - 1])) low -= 1;
  const text = value.slice(0, low);
  return { text, truncated: true, bytes: encoder.encode(text).byteLength };
}

function projectField(value) {
  return boundedUtf8(rawValue(value), MAX_EXECUTION_FIELD_BYTES);
}

export function projectExecutionCall(payload = {}) {
  const contract = CALL_TYPES.get(payload.type);
  if (!contract) return null;
  const input = projectField(payload[contract.input]);
  return Object.freeze({
    id: boundedId(payload.id),
    callId: boundedId(payload.call_id),
    name: boundedId(payload.name) || payload.type,
    status: boundedId(payload.status) || "requested",
    input: input.text,
    output: null,
    inputTruncated: input.truncated,
    outputTruncated: false
  });
}

export function projectExecutionResult(payload = {}) {
  if (!RESULT_TYPES.has(payload.type)) return null;
  const output = projectField(payload.output);
  return Object.freeze({
    id: boundedId(payload.id),
    callId: boundedId(payload.call_id),
    output: output.text,
    outputTruncated: output.truncated
  });
}

export function mergeExecutionResult(entry, result) {
  return Object.freeze({
    ...entry,
    status: entry.status === "requested" ? "completed" : entry.status,
    output: result.output,
    outputTruncated: result.outputTruncated
  });
}

export function executionDetailBytes(entry = {}) {
  return (typeof entry.input === "string" ? encoder.encode(entry.input).byteLength : 0)
    + (typeof entry.output === "string" ? encoder.encode(entry.output).byteLength : 0);
}

export function limitExecutionEntryDetail(entry, maxBytes) {
  let remaining = Math.max(0, maxBytes);
  const input = boundedUtf8(typeof entry.input === "string" ? entry.input : null, remaining);
  remaining -= input.bytes;
  const output = boundedUtf8(typeof entry.output === "string" ? entry.output : null, remaining);
  return Object.freeze({
    ...entry,
    input: input.text,
    output: output.text,
    inputTruncated: Boolean(entry.inputTruncated || input.truncated),
    outputTruncated: Boolean(entry.outputTruncated || output.truncated)
  });
}

function peerField(value, truncated, name) {
  if (value != null && typeof value !== "string") throw new Error(`Peer execution ${name} is invalid`);
  if (truncated != null && typeof truncated !== "boolean") throw new Error(`Peer execution ${name} truncation is invalid`);
  const bytes = typeof value === "string" ? encoder.encode(value).byteLength : 0;
  if (bytes > MAX_EXECUTION_FIELD_BYTES) throw new Error(`Peer execution ${name} is too large`);
  return { value: value ?? null, truncated: Boolean(truncated), bytes };
}

export function normalizePeerExecutionDetail(entry = {}) {
  const callId = entry.callId == null ? null : boundedId(entry.callId);
  if (entry.callId != null && !callId) throw new Error("Peer execution call id is invalid");
  const input = peerField(entry.input, entry.inputTruncated, "input");
  const output = peerField(entry.output, entry.outputTruncated, "output");
  return Object.freeze({
    callId,
    input: input.value,
    output: output.value,
    inputTruncated: input.truncated,
    outputTruncated: output.truncated,
    bytes: input.bytes + output.bytes
  });
}

