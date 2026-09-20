const MAX_PROMPT_BYTES = 128 * 1024;
const THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseNativeJevRoutingRequest(payload) {
  let value;
  try { value = JSON.parse(String(payload || "")); } catch { return null; }
  if (!value || typeof value !== "object" || Array.isArray(value) || !/^[A-Za-z0-9_.:-]{1,100}$/.test(String(value.id || ""))) return null;
  if (value.kind === "set-enabled" && typeof value.enabled === "boolean") return { id: String(value.id), kind: value.kind, enabled: value.enabled };
  if (value.kind === "set-thread-enabled" && THREAD_ID_PATTERN.test(String(value.threadId || "")) && typeof value.enabled === "boolean") return { id: String(value.id), kind: value.kind, threadId: String(value.threadId).toLowerCase(), enabled: value.enabled };
  if (value.kind !== "classify" || typeof value.prompt !== "string") return null;
  const prompt = value.prompt.trim();
  if (!prompt || Buffer.byteLength(prompt, "utf8") > MAX_PROMPT_BYTES) return null;
  return { id: String(value.id), kind: value.kind, prompt };
}

export async function handleNativeJevRoutingRequest(payload, service) {
  const request = parseNativeJevRoutingRequest(payload);
  if (!request || !service) return null;
  try {
    if (request.kind === "set-enabled") {
      await service.setEnabled(request.enabled);
      return { id: request.id, kind: request.kind, ok: true, snapshot: await service.snapshot() };
    }
    if (request.kind === "set-thread-enabled") {
      return { id: request.id, kind: request.kind, ok: true, snapshot: await service.setThreadEnabled(request.threadId, request.enabled) };
    }
    const classification = await service.classifyCurrent(request.prompt);
    return { id: request.id, kind: request.kind, ok: true, classification };
  } catch (error) {
    return { id: request.id, kind: request.kind, ok: false, message: String(error?.message || error).slice(0, 500) };
  }
}
