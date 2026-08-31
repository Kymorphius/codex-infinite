import test from "node:test";
import assert from "node:assert/strict";
import { normalizeApprovalProjection, normalizePendingApprovals, validateApprovalDecision } from "../src/approval-contract.mjs";

const threadId = "01a04445-8d03-7243-a4d3-181180bb626d";
const turnId = "01a04446-8d03-7243-a4d3-181180bb626e";
const token = "01a04447-8d03-7243-a4d3-181180bb626f";

function approval(overrides = {}) {
  return {
    token,
    kind: "command",
    threadId,
    turnId,
    itemId: "item-1",
    startedAtMs: 1_788_100_000_000,
    reason: "需要执行测试",
    command: "npm test",
    cwd: "/workspace/project",
    networkHost: null,
    permissionSummary: [],
    decisions: ["accept", "decline"],
    ...overrides
  };
}

test("approval projection accepts only the bounded redacted contract", () => {
  const normalized = normalizeApprovalProjection(approval(), { expectedThreadId: threadId });
  assert.equal(normalized.token, token);
  assert.equal(normalized.command, "npm test");
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(Object.isFrozen(normalized.decisions), true);
  assert.equal("requestId" in normalized, false);
});

test("pending approvals reject cross-thread, duplicate, oversized, and expanded decisions", () => {
  assert.throws(() => normalizePendingApprovals([approval()], { expectedThreadId: turnId }), /another thread/);
  assert.throws(() => normalizePendingApprovals([approval(), approval()]), /duplicated/);
  assert.throws(() => normalizePendingApprovals([approval({ command: "x".repeat(4_001) })]), /command is invalid/);
  assert.throws(() => normalizePendingApprovals([approval({ decisions: ["acceptForSession"] })]), /decisions are invalid/);
  assert.throws(() => normalizePendingApprovals(Array.from({ length: 9 }, (_, index) => approval({ token: `01a04447-8d03-7243-a4d3-181180bb62${String(index).padStart(2, "0")}` }))), /contract is invalid/);
});

test("approval decisions are limited to accept once and decline", () => {
  assert.equal(validateApprovalDecision("accept"), "accept");
  assert.equal(validateApprovalDecision("decline"), "decline");
  assert.throws(() => validateApprovalDecision("acceptForSession"), /invalid/);
});

