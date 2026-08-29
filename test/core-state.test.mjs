import test from "node:test";
import assert from "node:assert/strict";
import { createAppState, MODULES } from "../public/core/state.js";

test("browser state accepts only registered modules and creates isolated mutable state", () => {
  const zoteroState = createAppState("zotero");
  const invalidState = createAppState("unknown");
  assert.equal(zoteroState.module, "zotero");
  assert.equal(invalidState.module, "board");
  assert.equal(Object.hasOwn(MODULES, "sessions"), true);
  zoteroState.tasks.push({ id: "one" });
  assert.deepEqual(invalidState.tasks, []);
});
