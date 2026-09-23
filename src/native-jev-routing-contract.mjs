const ROUTE_MODELS = new Set(["gpt-6-luna", "gpt-6-sol", "gpt-6-astra", "gpt-reserve", "gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.5"]);
const ROUTE_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max", "ultra"]);
const THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function formatNativeJevEffort(value) {
  const labels = { none: "无", minimal: "极低", low: "轻度", medium: "中", high: "高", xhigh: "极高", max: "最高", ultra: "Ultra" };
  return labels[value] || String(value || "");
}

export function formatNativeJevTurnChoice(value = {}) {
  const tiers = { instant: "即时", quick: "轻快", everyday: "日常", substantial: "进阶", complex: "复杂", deep: "深度", critical: "关键", extreme: "极限" };
  const tier = tiers[value.tier] || String(value.tier || "").trim();
  const model = String(value.model || "").trim().replace(/^gpt-/i, "GPT-").replace(/-(luna|terra|sol|astra)$/i, (_, name) => ` ${name[0].toUpperCase()}${name.slice(1).toLowerCase()}`).replace(/^GPT-reserve$/, "GPT-Reserve");
  const effort = String(value.effort || "").trim();
  return tier && model && effort ? `Jev · ${tier} · ${model} · ${formatNativeJevEffort(effort)}${value.fallback ? " · 兜底" : value.lowConfidence ? " · 低置信度" : ""}` : "";
}

export function formatNativeJevModelChange(value = {}) {
  const labels = { "gpt-6-luna": "GPT-6 Luna", "gpt-6-sol": "GPT-6 Sol", "gpt-6-astra": "GPT-6 Astra", "gpt-reserve": "GPT-Reserve", "gpt-5.6-luna": "GPT-5.6 Luna", "gpt-5.6-terra": "GPT-5.6 Terra", "gpt-5.6-sol": "GPT-5.6 Sol", "gpt-5.5": "GPT-5.5" };
  const model = labels[value.model] || String(value.model || "").trim();
  const effort = String(value.effort || "").trim();
  if (!model || !effort) return "";
  const confidence = Number.isFinite(value.confidence) ? value.confidence.toFixed(2) : "—";
  return `模型已设置为 ${model}，推理强度 ${formatNativeJevEffort(effort)}，置信度 ${confidence}${value.fallback ? "（兜底）" : value.lowConfidence ? "（低置信度）" : ""}。`;
}

export function selectNativeJevRoutingTurn(candidates = [], prompt = "", beforeIds = [], usedIds = [], allowExisting = false) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const before = new Set(Array.isArray(beforeIds) ? beforeIds : []), used = new Set(Array.isArray(usedIds) ? usedIds : []);
  const available = (Array.isArray(candidates) ? candidates : []).filter((item) => uuid.test(String(item?.id || "")) && !used.has(String(item.id).toLowerCase()));
  const text = String(prompt || "").trim();
  if (text) {
    const exact = [...available].reverse().find((item) => String(item.userText || "").trim() === text && !before.has(String(item.id).toLowerCase()));
    if (exact) return String(exact.id).toLowerCase();
  }
  const appended = [...available].reverse().find((item) => !before.has(String(item.id).toLowerCase()));
  if (appended) return String(appended.id).toLowerCase();
  if (!allowExisting) return null;
  const existing = text ? [...available].reverse().find((item) => String(item.userText || "").trim() === text) : available.at(-1);
  return existing ? String(existing.id).toLowerCase() : null;
}

export async function releaseNativeJevSend(findSend, release, wait, now = Date.now, timeoutMs = 5000) {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const send = findSend();
    if (send && !send.disabled) { release(send); return true; }
    await wait(80);
  }
  return false;
}

export function normalizeNativeJevRoutingSnapshot(snapshot = {}) {
  if (!snapshot?.config || typeof snapshot.config !== "object") {
    return { enabled: false, available: false, transportMode: "router", fallbackTier: "everyday", mappings: {}, threadOverrides: {}, receipts: [] };
  }
  const config = snapshot.config;
  const mappings = {};
  for (const [tier, value] of Object.entries(config.mappings || {})) {
    if (/^[a-z]{1,24}$/.test(tier) && ROUTE_MODELS.has(value?.model) && ROUTE_EFFORTS.has(value?.effort)) mappings[tier] = { model: value.model, effort: value.effort };
  }
  const threadOverrides = {};
  for (const [rawThreadId, enabled] of Object.entries(snapshot.threadOverrides || {})) {
    const threadId = String(rawThreadId).toLowerCase();
    if (THREAD_ID_PATTERN.test(threadId) && typeof enabled === "boolean") threadOverrides[threadId] = enabled;
  }
  const receipts = (Array.isArray(snapshot.receipts) ? snapshot.receipts : []).flatMap((value) => {
    const threadId = String(value?.threadId || "").toLowerCase(), turnId = String(value?.turnId || "").toLowerCase();
    if (!THREAD_ID_PATTERN.test(threadId) || !THREAD_ID_PATTERN.test(turnId) || !ROUTE_MODELS.has(value?.model) || !ROUTE_EFFORTS.has(value?.effort)) return [];
    return [{ threadId, turnId, tier: String(value?.tier || "").slice(0, 24), model: value.model, effort: value.effort, confidence: Number.isFinite(value?.confidence) ? value.confidence : null, lowConfidence: value?.lowConfidence === true, fallback: value?.fallback === true, reason: String(value?.reason || "").slice(0, 500), routedAt: String(value?.routedAt || "").slice(0, 64) }];
  }).slice(-512);
  return { enabled: config.enabled !== false, available: snapshot.available === true, transportMode: config.transportMode === "native" ? "native" : "router", fallbackTier: typeof config.fallbackTier === "string" ? config.fallbackTier : "everyday", mappings, threadOverrides, receipts };
}
