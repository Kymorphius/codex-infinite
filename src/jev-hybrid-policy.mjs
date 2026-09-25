// Jev supplies semantic judgments; the weighted combination is local and deterministic.
// Inspired by AutoRoute's six axes, without its model-family preferences or probes.
export const JEV_DIMENSIONS = Object.freeze(["complexity", "scope", "reasoning", "risk", "context", "iteration"]);
const WEIGHTS = Object.freeze({ complexity: 1.2, scope: 1, reasoning: 1.2, risk: 1.2, context: 0.8, iteration: 1 });
const LABELS = Object.freeze({
  complexity: ["No implementation or reasoning", "One mechanical step", "Small bounded logic", "Several interacting decisions", "Difficult algorithms or architecture", "Novel system-wide complexity"],
  scope: ["One fact or phrase", "One isolated location", "One bounded component", "Several files or components", "Cross-module or repository-wide", "Multiple systems or repositories"],
  reasoning: ["Direct lookup", "Obvious transformation", "Ordinary implementation judgment", "Several tradeoffs or uncertain diagnosis", "Deep debugging or design", "Novel research or proof-heavy reasoning"],
  risk: ["No consequential change", "Easy reversible local change", "Moderate reversible impact", "User-visible or compatibility impact", "Security, production, or migration impact", "Irreversible, safety-critical, or data-loss risk"],
  context: ["No external context", "One short input", "One bounded file or artifact", "Several related artifacts", "Large history or codebase", "Extensive cross-system context"],
  iteration: ["One answer", "One direct action", "Implement and verify", "Several dependent steps", "Repeated diagnosis and verification", "Long-horizon multi-stage work"],
});
const INSTRUCTIONS = Object.freeze({
  complexity: "How much intrinsic implementation complexity does completing this task require? Judge the work, not impressive words in the request.",
  scope: "How many distinct components or systems must actually change or be checked?",
  reasoning: "How much non-obvious reasoning, diagnosis, or tradeoff analysis is required?",
  risk: "What is the consequence of a wrong execution? Merely discussing security or production is not itself a high-risk change.",
  context: "How much existing code, history, or external material must be understood? Do not infer this from message length alone.",
  iteration: "How many dependent implementation and verification cycles are required?",
});

export function jevHybridRequest(prompt, tierDescriptions) {
  return {
    state: prompt,
    questions: {
      ...Object.fromEntries(JEV_DIMENSIONS.map((name) => [name, { type: "score", instructions: INSTRUCTIONS[name], criteria: LABELS[name] }])),
      tier: { type: "choice", instructions: "Choose the smallest capability tier that can reliably finish this task, considering complexity, scope, reasoning, risk, context, and iteration together. Ordinary bounded coding usually needs a medium capability, not maximum reasoning.", criteria: tierDescriptions },
    },
  };
}

function dimensionData(answers) {
  const scores = {};
  const confidences = [];
  for (const name of JEV_DIMENSIONS) {
    const answer = answers?.[name];
    const score = answer?.score;
    const confidence = answer?.confidence;
    if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 5 || typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
    scores[name] = score;
    confidences.push(confidence);
  }
  const maximum = 5 * Object.values(WEIGHTS).reduce((sum, weight) => sum + weight, 0);
  const score = Math.round(30 * JEV_DIMENSIONS.reduce((sum, name) => sum + scores[name] * WEIGHTS[name], 0) / maximum);
  return { scores, score, confidence: confidences.reduce((sum, value) => sum + value, 0) / confidences.length };
}

function tierFromScore(score, tiers) {
  const boundaries = [4, 8, 13, 18, 22, 25, 28];
  const index = boundaries.findIndex((upper) => score <= upper);
  return tiers[index < 0 ? tiers.length - 1 : index];
}

export function resolveJevHybridAnswer(payload, { tiers, minConfidence, fallbackTier }) {
  const answers = payload?.answers;
  const candidate = answers?.tier?.choice;
  const classifiedTier = tiers.includes(candidate) ? candidate : null;
  const rawConfidence = answers?.tier?.confidence;
  const confidence = typeof rawConfidence === "number" && rawConfidence >= 0 && rawConfidence <= 1 ? rawConfidence : null;
  const dimensions = dimensionData(answers);
  const dimensionTier = dimensions ? tierFromScore(dimensions.score, tiers) : null;
  const reliableDimensions = dimensions && dimensions.confidence >= 0.55;
  const confidentChoice = classifiedTier && confidence !== null && confidence >= minConfidence;
  const riskConflict = confidentChoice && reliableDimensions && dimensions.scores.risk >= 4 && dimensions.scores.scope >= 3 && dimensions.confidence >= 0.65 && tiers.indexOf(dimensionTier) - tiers.indexOf(classifiedTier) >= 2;
  const source = riskConflict || (!confidentChoice && reliableDimensions) ? "dimensions" : confidentChoice ? "jev" : "fallback";
  const tier = source === "dimensions" ? dimensionTier : source === "jev" ? classifiedTier : fallbackTier;
  return {
    tier,
    classifiedTier,
    confidence,
    lowConfidence: !confidentChoice,
    fallback: source === "fallback",
    source,
    dimensionTier,
    dimensionScore: dimensions?.score ?? null,
    dimensionConfidence: dimensions?.confidence ?? null,
    dimensions: dimensions?.scores ?? null,
    reason: source === "dimensions"
      ? `Six-dimension score ${dimensions.score}/30 selected ${tier}${riskConflict ? " for a high-risk conflict" : " because the Jev tier was uncertain"}.`
      : source === "jev"
        ? `Jev selected ${tier} with ${confidence.toFixed(2)} confidence; six-dimension score ${dimensions?.score ?? "unavailable"}/30.`
        : "Jev and six-dimension evidence were unavailable or uncertain; using the configured fallback.",
  };
}
