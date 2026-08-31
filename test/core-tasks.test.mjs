import test from "node:test";
import assert from "node:assert/strict";
import { createTaskSource, isLocalTask, normalizeTaskPayload, taskStatePresentation } from "../public/core/tasks.js";

test("task payload normalization keeps only normalized arrays and truthful state", () => {
  assert.deepEqual(normalizeTaskPayload({ status: "connected", tasks: [{ id: "one" }], projects: null }), {
    tasks: [{ id: "one" }], projects: [], devices: [], status: "connected", message: ""
  });
  assert.equal(normalizeTaskPayload({ status: "connected", tasks: [] }).status, "error");
  assert.deepEqual(taskStatePresentation("disconnected", "offline"), {
    status: "disconnected", label: "未连接", source: "不可用", message: "offline"
  });
});

test("remote node tasks are excluded from local-only actions", () => {
  assert.equal(isLocalTask({ device: { kind: "local-codex" } }), true);
  assert.equal(isLocalTask({ device: { kind: "remote-codex" } }), false);
  assert.equal(isLocalTask({}), true);
});

test("task source updates normalized state before notifying consumers", async () => {
  const state = { tasks: [], projects: [], devices: [] };
  const events = [];
  const source = createTaskSource({
    state,
    onState(value) { events.push(["state", value.status]); },
    onData(value) { events.push(["data", value.status, state.tasks.length]); },
    async fetchImpl() {
      return { ok: true, async json() { return { status: "connected", tasks: [{ id: "one" }], projects: ["p"], devices: ["d"] }; } };
    }
  });
  await source.load();
  assert.deepEqual(events, [["state", "loading"], ["data", "connected", 1], ["state", "connected"]]);
  assert.deepEqual(state.projects, ["p"]);
  assert.deepEqual(state.devices, ["d"]);
});
