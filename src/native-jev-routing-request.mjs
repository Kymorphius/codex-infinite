const MAX_PROMPT_BYTES = 128 * 1024;
const THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
import { JEV_ROUTE_TIERS, supportsJevRoute } from "./jev-routing-policy.mjs";

function parseMappings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== JEV_ROUTE_TIERS.length || keys.some((tier) => !JEV_ROUTE_TIERS.includes(tier))) return null;
  const mappings = {};
  for (const tier of JEV_ROUTE_TIERS) {
    const mapping = value[tier];
    const model = typeof mapping?.model === "string" ? mapping.model.trim() : "";
    const effort = typeof mapping?.effort === "string" ? mapping.effort.trim().toLowerCase() : "";
    if (!supportsJevRoute(model, effort)) return null;
    mappings[tier] = { model, effort };
  }
  return mappings;
}

export function parseNativeJevRoutingRequest(payload) {
  let value;
  try { value = JSON.parse(String(payload || "")); } catch { return null; }
  if (!value || typeof value !== "object" || Array.isArray(value) || !/^[A-Za-z0-9_.:-]{1,100}$/.test(String(value.id || ""))) return null;
  if (value.kind === "set-enabled" && typeof value.enabled === "boolean") return { id: String(value.id), kind: value.kind, enabled: value.enabled };
  if (value.kind === "set-thread-enabled" && THREAD_ID_PATTERN.test(String(value.threadId || "")) && typeof value.enabled === "boolean") return { id: String(value.id), kind: value.kind, threadId: String(value.threadId).toLowerCase(), enabled: value.enabled };
  if (value.kind === "set-mappings") { const mappings = parseMappings(value.mappings); return mappings ? { id: String(value.id), kind: value.kind, mappings } : null; }
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
    if (request.kind === "set-mappings") {
      const snapshot = await service.snapshot();
      await service.update({ ...snapshot.config, mappings: request.mappings });
      return { id: request.id, kind: request.kind, ok: true, snapshot: await service.snapshot() };
    }
    const classification = await service.classifyCurrent(request.prompt);
    return { id: request.id, kind: request.kind, ok: true, classification };
  } catch (error) {
    return { id: request.id, kind: request.kind, ok: false, message: String(error?.message || error).slice(0, 500) };
  }
}
