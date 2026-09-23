import test from "node:test";
import assert from "node:assert/strict";
import { planModelReplacement } from "../public/features/sessions/model-bulk.js";

const id = "01a04445-8d03-7243-a4d3-181180bb626d";

test("bulk model preview selects only matching readable sessions on supported connected devices", () => {
  const tasks = [
    { id, model: "gpt-5.6-sol", device: { id: "mac", status: "connected" } },
    { id: "01a04445-8d03-7243-a4d3-181180bb626e", model: "gpt-5.6-sol", device: { id: "old", status: "connected" } },
    { id: "01a04445-8d03-7243-a4d3-181180bb626f", model: "gpt-5.6-sol", device: { id: "offline", status: "error" } },
    { id: "01a04445-8d03-7243-a4d3-181180bb6270", model: "gpt-6-sol", device: { id: "mac", status: "connected" } }
  ];
  const catalogs = new Map([["mac", [{ id: "gpt-6-sol" }]], ["old", [{ id: "gpt-5.6-sol" }]], ["offline", [{ id: "gpt-6-sol" }]]]);
  const plan = planModelReplacement(tasks, catalogs, "gpt-5.6-sol", "gpt-6-sol");
  assert.equal(plan.matching.length, 3);
  assert.deepEqual(plan.eligible.map((task) => task.id), [id]);
  assert.equal(plan.skipped, 2);
});
