import assert from "node:assert/strict";
import test from "node:test";
import { jevHybridRequest, resolveJevHybridAnswer } from "../src/jev-hybrid-policy.mjs";
import { JEV_ROUTE_TIERS } from "../src/jev-routing-policy.mjs";

const settings = { tiers: JEV_ROUTE_TIERS, minConfidence: 0.7, fallbackTier: "everyday" };
function response(choice, confidence, scores, dimensionConfidence = 0.8) {
  return { answers: {
    tier: { type: "choice", choice, confidence },
    ...Object.fromEntries(["complexity", "scope", "reasoning", "risk", "context", "iteration"].map((name, index) => [name, { type: "score", score: scores[index], confidence: dimensionConfidence }])),
  } };
}

test("one request asks Jev for six semantic dimensions and the tier without model preferences", () => {
  const request = jevHybridRequest("Fix the bug", Object.fromEntries(JEV_ROUTE_TIERS.map((tier) => [tier, tier])));
  assert.equal(request.state, "Fix the bug");
  assert.deepEqual(Object.keys(request.questions), ["complexity", "scope", "reasoning", "risk", "context", "iteration", "tier"]);
  assert.ok(Object.values(request.questions).every((question) => question.type === "score" || question.type === "choice"));
  assert.doesNotMatch(JSON.stringify(request), /gpt-5\.2|gpt-6-astra/);
});

test("confident Jev choice remains primary while dimensions are retained", () => {
  const result = resolveJevHybridAnswer(response("quick", 0.9, [2, 2, 2, 1, 2, 2]), settings);
  assert.equal(result.tier, "quick");
  assert.equal(result.source, "jev");
  assert.equal(result.lowConfidence, false);
  assert.equal(result.dimensions.scope, 2);
});

test("low-confidence choice uses reliable six-dimensional score, not the fixed fallback", () => {
  const result = resolveJevHybridAnswer(response("instant", 0.4, [3, 3, 3, 3, 3, 3]), settings);
  assert.equal(result.tier, "substantial");
  assert.equal(result.dimensionScore, 18);
  assert.equal(result.source, "dimensions");
  assert.equal(result.lowConfidence, true);
  assert.equal(result.fallback, false);
});

test("high-risk cross-system conflict can raise an undercalled confident tier", () => {
  const result = resolveJevHybridAnswer(response("everyday", 0.85, [4, 4, 4, 5, 3, 4]), settings);
  assert.equal(result.tier, "deep");
  assert.equal(result.source, "dimensions");
  assert.equal(result.lowConfidence, false);
  assert.match(result.reason, /high-risk conflict/);
});

test("incomplete or uncertain dimensions never masquerade as a reliable route", () => {
  const incomplete = response("quick", 0.4, [3, 3, 3, 3, 3, 3]);
  delete incomplete.answers.risk;
  assert.equal(resolveJevHybridAnswer(incomplete, settings).source, "fallback");
  assert.equal(resolveJevHybridAnswer(response("quick", 0.4, [3, 3, 3, 3, 3, 3], 0.2), settings).tier, "everyday");
  assert.equal(resolveJevHybridAnswer(incomplete, { ...settings, minConfidence: 0.3 }).tier, "quick");
});
