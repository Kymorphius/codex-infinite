export function normalizeNativeTurboTurnReceipt(value) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const threadId = String(value?.threadId || "").toLowerCase();
  const turnId = String(value?.turnId || "").toLowerCase();
  const model = typeof value?.model === "string" ? value.model.trim() : "";
  const effort = value?.effort;
  if (!uuid.test(threadId) || !uuid.test(turnId) || !/^[a-z0-9][a-z0-9._:/-]{0,119}$/i.test(model)) return null;
  if (!["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"].includes(effort)) return null;
  if (!["turn-start-request", "native-settings"].includes(value?.source)) return null;
  if (!Number.isSafeInteger(value.recordedAt) || value.recordedAt < 0) return null;
  return {
    threadId, turnId, model, effort, source: value.source, recordedAt: value.recordedAt,
    serviceTier: ["default", "priority", "ultrafast"].includes(value.serviceTier) ? value.serviceTier : null,
    contextWindow: Number.isSafeInteger(value.contextWindow) && value.contextWindow > 0 && value.contextWindow <= 10000000 ? value.contextWindow : null
  };
}

export function formatNativeTurboTurnReceipt(value) {
  const efforts = { none: "无", minimal: "极低", low: "轻度", medium: "中", high: "高", xhigh: "极高", max: "最高", ultra: "Ultra" };
  const model = String(value?.model || "").replace(/^gpt-/i, "GPT-").replace(/-(luna|terra|sol|astra)$/i, (_, name) => ` ${name[0].toUpperCase()}${name.slice(1).toLowerCase()}`);
  if (!model || !efforts[value?.effort]) return "";
  return ["Turbo", model, efforts[value.effort], value.serviceTier === "priority" ? "Fast" : value.serviceTier === "ultrafast" ? "Ultrafast" : null, value.contextWindow >= 1000000 ? "百万" : null].filter(Boolean).join(" · ");
}

// Only explicit dispatch parameters are evidence. Never fill missing fields from
// a later policy or from the currently selected conversation.
export function readNativeTurboTurnRequest(message, contextWindow) {
  if (message?.type !== "mcp-request" || message.hostId !== "local" || message.request?.method !== "turn/start") return null;
  const params = message.request.params;
  const settings = params?.collaborationMode?.settings;
  return {
    threadId: params?.threadId,
    model: settings?.model ?? params?.model,
    effort: settings?.reasoning_effort ?? params?.effort,
    serviceTier: params?.serviceTierForTurn,
    contextWindow,
    source: "turn-start-request"
  };
}
