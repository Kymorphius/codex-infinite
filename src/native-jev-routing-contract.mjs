const ROUTE_MODELS = new Set(["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol", "gpt-6-astra"]);
const ROUTE_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max", "ultra"]);
const THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function formatNativeJevTurnChoice(value = {}) {
  const tiers = { instant: "即时", quick: "轻快", everyday: "日常", substantial: "进阶", complex: "复杂", deep: "深度", critical: "关键", extreme: "极限" };
  const tier = tiers[value.tier] || String(value.tier || "").trim();
  const model = String(value.model || "").trim().replace(/^gpt-/i, "GPT-").replace(/-(luna|terra|sol|astra)$/i, (_, name) => ` ${name[0].toUpperCase()}${name.slice(1).toLowerCase()}`);
  const effort = String(value.effort || "").trim();
  return tier && model && effort ? `Jev · ${tier} · ${model} · ${effort}${value.fallback ? " · 兜底" : ""}` : "";
}

export function selectNativeJevRoutingTurn(candidates = [], prompt = "", beforeIds = [], usedIds = [], allowExisting = false) {
  const before = new Set(Array.isArray(beforeIds) ? beforeIds : []), used = new Set(Array.isArray(usedIds) ? usedIds : []);
  const available = (Array.isArray(candidates) ? candidates : []).filter((item) => THREAD_ID_PATTERN.test(String(item?.id || "")) && !used.has(String(item.id).toLowerCase()));
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

export function normalizeNativeJevRoutingSnapshot(snapshot = {}) {
  if (!snapshot?.config || typeof snapshot.config !== "object") {
    return { enabled: false, available: false, fallbackTier: "everyday", mappings: {}, threadOverrides: {} };
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
  return { enabled: config.enabled !== false, available: snapshot.available === true, fallbackTier: typeof config.fallbackTier === "string" ? config.fallbackTier : "everyday", mappings, threadOverrides };
}
