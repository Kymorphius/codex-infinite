const MAX_ENTRIES = 60;
const MAX_TEXT_LENGTH = 4000;
const MAX_TOTAL_TEXT = 64 * 1024;

function cleanText(value, maxLength = MAX_TEXT_LENGTH) {
  return String(value || "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, maxLength);
}

function messageText(content) {
  if (!Array.isArray(content)) return "";
  return cleanText(content.filter((item) => ["input_text", "output_text"].includes(item?.type)).map((item) => item.text || "").join("\n"));
}

export function parseConversationActivity(content, { threadId = "", maxEntries = MAX_ENTRIES } = {}) {
  const entries = [];
  let sequence = 0;
  for (const line of String(content).split(/\r?\n/)) {
    if (!line.trim()) continue;
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    const payload = record?.payload;
    if (!payload) continue;
    let entry = null;
    if (record.type === "response_item" && payload.type === "message" && ["user", "assistant"].includes(payload.role)) {
      const text = messageText(payload.content);
      if (text) entry = { kind: "message", role: payload.role, phase: cleanText(payload.phase, 32) || null, text };
    } else if (record.type === "response_item" && ["custom_tool_call", "function_call", "web_search_call"].includes(payload.type)) {
      entry = { kind: "tool", name: cleanText(payload.name || payload.type, 120), status: cleanText(payload.status, 32) || "requested" };
    } else if (record.type === "event_msg" && ["task_started", "task_complete"].includes(payload.type)) {
      entry = { kind: "status", status: payload.type === "task_started" ? "started" : "completed" };
    }
    if (!entry) continue;
    entries.push(Object.freeze({ id: cleanText(payload.id || payload.call_id, 160) || `${sequence}`, timestamp: cleanText(record.timestamp, 64) || null, ...entry }));
    sequence += 1;
  }
  let remainingText = MAX_TOTAL_TEXT;
  const selected = [];
  for (const original of entries.slice(-Math.min(MAX_ENTRIES, Math.max(1, maxEntries))).reverse()) {
    if (!original.text) selected.push(original);
    else if (remainingText > 0) {
      const text = original.text.slice(-remainingText);
      remainingText -= text.length;
      selected.push(Object.freeze({ ...original, text }));
    }
  }
  return Object.freeze({ schemaVersion: 1, threadId: cleanText(threadId, 160), entries: Object.freeze(selected.reverse()) });
}

export function normalizePeerActivity(peer, payload = {}) {
  if (payload.schemaVersion !== 1 || !Array.isArray(payload.entries) || payload.entries.length > MAX_ENTRIES) throw new Error("Peer activity contract is invalid");
  if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > 256 * 1024) throw new Error("Peer activity response is too large");
  let totalText = 0;
  const entries = payload.entries.map((entry) => {
    const base = { id: cleanText(entry?.id, 160), timestamp: cleanText(entry?.timestamp, 64) || null };
    if (entry?.kind === "message" && ["user", "assistant"].includes(entry.role) && typeof entry.text === "string") {
      const text = cleanText(entry.text);
      totalText += text.length;
      if (totalText > MAX_TOTAL_TEXT) throw new Error("Peer activity text is too large");
      return Object.freeze({ ...base, kind: "message", role: entry.role, phase: cleanText(entry.phase, 32) || null, text });
    }
    if (entry?.kind === "tool" && typeof entry.name === "string") return Object.freeze({ ...base, kind: "tool", name: cleanText(entry.name, 120), status: cleanText(entry.status, 32) || "requested" });
    if (entry?.kind === "status" && ["started", "completed"].includes(entry.status)) return Object.freeze({ ...base, kind: "status", status: entry.status });
    throw new Error("Peer activity entry is invalid");
  });
  return Object.freeze({
    schemaVersion: 1,
    threadId: cleanText(payload.threadId, 160),
    title: cleanText(payload.title, 160) || null,
    updatedAt: cleanText(payload.updatedAt, 64) || null,
    entries: Object.freeze(entries),
    device: Object.freeze({ id: peer.id, name: peer.name, kind: "remote-codex", location: peer.location, status: "connected" })
  });
}
