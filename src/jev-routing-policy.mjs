export const JEV_ROUTE_TIERS = Object.freeze([
  "instant",
  "quick",
  "everyday",
  "substantial",
  "complex",
  "deep",
  "critical",
  "extreme"
]);
export const JEV_ROUTE_EFFORTS = Object.freeze(["low", "medium", "high", "xhigh", "max", "ultra"]);
export const JEV_ROUTE_MODEL_EFFORTS = Object.freeze({
  "gpt-6.1-sol": JEV_ROUTE_EFFORTS,
  "gpt-6-luna": Object.freeze(["low", "medium", "high", "xhigh", "max"]),
  "gpt-6-sol": JEV_ROUTE_EFFORTS,
  "gpt-6-astra": JEV_ROUTE_EFFORTS,
  "gpt-reserve": Object.freeze(["low", "medium", "high", "xhigh", "max"]),
  "gpt-5.6-luna": Object.freeze(["low", "medium", "high", "xhigh", "max"]),
  "gpt-5.6-terra": JEV_ROUTE_EFFORTS,
  "gpt-5.6-sol": JEV_ROUTE_EFFORTS,
  "gpt-5.5": Object.freeze(["low", "medium", "high", "xhigh"])
});
export const JEV_ROUTE_MODELS = Object.freeze(Object.keys(JEV_ROUTE_MODEL_EFFORTS));

export function supportsJevRoute(model, effort) {
  return JEV_ROUTE_MODEL_EFFORTS[model]?.includes(effort) === true;
}

const DEFAULT_MAPPINGS = Object.freeze({
  instant: Object.freeze({ model: "gpt-5.6-luna", effort: "low" }),
  quick: Object.freeze({ model: "gpt-5.6-luna", effort: "medium" }),
  everyday: Object.freeze({ model: "gpt-5.6-terra", effort: "medium" }),
  substantial: Object.freeze({ model: "gpt-5.6-terra", effort: "high" }),
  complex: Object.freeze({ model: "gpt-5.6-sol", effort: "high" }),
  deep: Object.freeze({ model: "gpt-5.6-sol", effort: "xhigh" }),
  critical: Object.freeze({ model: "gpt-6-astra", effort: "xhigh" }),
  extreme: Object.freeze({ model: "gpt-6-astra", effort: "ultra" })
});

export const JEV_TIER_DESCRIPTIONS = Object.freeze({
  instant: "Tiny deterministic work such as a lookup, formatting change, or one-step edit",
  quick: "Small, mechanical, well-specified work with low ambiguity and low risk",
  everyday: "Contained implementation, debugging, or analysis with moderate judgment",
  substantial: "Multi-file implementation or debugging with several interacting dependencies",
  complex: "Cross-module or research-heavy work that needs sustained reasoning",
  deep: "Difficult systems work that needs prolonged reasoning and careful verification",
  critical: "High-risk architectural, security, migration, or multi-system work",
  extreme: "Exceptionally ambiguous or high-stakes work requiring exhaustive reasoning and verification"
});

export function defaultJevRoutingConfig() {
  return {
    version: 4,
    enabled: true,
    transportMode: "router",
    minConfidence: 0.7,
    fallbackTier: "everyday",
    mappings: Object.fromEntries(JEV_ROUTE_TIERS.map((tier) => [tier, { ...DEFAULT_MAPPINGS[tier] }]))
  };
}

function normalizeMapping(value, tier) {
  const model = typeof value?.model === "string" ? value.model.trim() : "";
  const effort = typeof value?.effort === "string" ? value.effort.trim().toLowerCase() : "";
  if (!JEV_ROUTE_MODELS.includes(model)) throw new Error(`${tier} 的模型不受支持`);
  if (!JEV_ROUTE_EFFORTS.includes(effort)) throw new Error(`${tier} 的推理强度不受支持`);
  if (!supportsJevRoute(model, effort)) throw new Error(`${model} 不支持 ${effort === "ultra" ? "Ultra" : effort} 推理强度`);
  return { model, effort };
}

export function normalizeJevRoutingConfig(value) {
  const defaults = defaultJevRoutingConfig();
  const minConfidence = Number(value?.minConfidence ?? defaults.minConfidence);
  if (!Number.isFinite(minConfidence) || minConfidence < 0.5 || minConfidence > 0.95) throw new Error("最低置信度必须在 0.50 到 0.95 之间");
  const fallbackTier = typeof value?.fallbackTier === "string" ? value.fallbackTier : defaults.fallbackTier;
  if (!JEV_ROUTE_TIERS.includes(fallbackTier)) throw new Error("兜底档位无效");
  const transportMode = value?.transportMode ?? defaults.transportMode;
  if (!["native", "router"].includes(transportMode)) throw new Error("Jev 传输方式无效");
  return {
    version: 4,
    enabled: typeof value?.enabled === "boolean" ? value.enabled : defaults.enabled,
    transportMode,
    minConfidence,
    fallbackTier,
    mappings: Object.fromEntries(JEV_ROUTE_TIERS.map((tier) => [tier, normalizeMapping(value?.mappings?.[tier] ?? defaults.mappings[tier], tier)]))
  };
}

export function fallbackJevClassification(configValue, reason, extra = {}) {
  const config = normalizeJevRoutingConfig(configValue);
  const tier = config.fallbackTier;
  return { tier, confidence: null, fallback: true, source: "fallback", reason, ...extra, ...config.mappings[tier] };
}
