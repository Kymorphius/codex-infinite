import test from "node:test";
import assert from "node:assert/strict";
import { projectOrderFromTaskResponse } from "../src/injector.mjs";

test("sidebar project order follows ranked projects and removes duplicates", () => {
  assert.deepEqual(projectOrderFromTaskResponse({ projects: [
    { project: "PAVoice", priorityScore: 99 },
    { project: "PABar", priorityScore: 86 },
    { project: "PAVoice", priorityScore: 80 },
    { project: "  mulitca  ", priorityScore: 70 },
    { project: "" }
  ] }), ["PAVoice", "PABar", "mulitca"]);
});
