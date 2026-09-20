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
export const JEV_ROUTE_MODELS = Object.freeze(["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol", "gpt-6-astra"]);
export const JEV_ROUTE_EFFORTS = Object.freeze(["low", "medium", "high", "xhigh", "max", "ultra"]);

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
    version: 2,
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
  if (model === "gpt-5.6-luna" && effort === "ultra") throw new Error("GPT-5.6 Luna 不支持 Ultra 推理强度");
  return { model, effort };
}

export function normalizeJevRoutingConfig(value) {
  const defaults = defaultJevRoutingConfig();
  const minConfidence = Number(value?.minConfidence ?? defaults.minConfidence);
  if (!Number.isFinite(minConfidence) || minConfidence < 0.5 || minConfidence > 0.95) throw new Error("最低置信度必须在 0.50 到 0.95 之间");
  const fallbackTier = typeof value?.fallbackTier === "string" ? value.fallbackTier : defaults.fallbackTier;
  if (!JEV_ROUTE_TIERS.includes(fallbackTier)) throw new Error("兜底档位无效");
  return {
    version: 2,
    minConfidence,
    fallbackTier,
    mappings: Object.fromEntries(JEV_ROUTE_TIERS.map((tier) => [tier, normalizeMapping(value?.mappings?.[tier] ?? defaults.mappings[tier], tier)]))
  };
}

export function fallbackJevClassification(configValue, reason, extra = {}) {
  const config = normalizeJevRoutingConfig(configValue);
  const tier = config.fallbackTier;
  return { tier, confidence: null, fallback: true, reason, ...extra, ...config.mappings[tier] };
}
