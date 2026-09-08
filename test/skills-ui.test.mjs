import test from "node:test";
import assert from "node:assert/strict";
import { groupSkills } from "../public/features/skills/index.js";
import { createGroupControls, groupSyncRequests, groupToggleRequests, runGroupRequests, syncResultHasFailures } from "../public/features/skills/group-actions.js";

class FakeElement {
  constructor(tagName) { this.tagName = tagName.toUpperCase(); this.children = []; this.dataset = {}; this.listeners = {}; }
  append(...children) { this.children.push(...children); }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  setAttribute(name, value) { this[name] = value; }
}

test("Skill UI groups personal entries first and repository entries by project", () => {
  const groups = groupSkills([
    { scope: "repo", projectName: "WorldManager", name: "review", enabled: true },
    { scope: "codex-user", name: "orch", enabled: true },
    { scope: "repo", projectName: "Another", name: "tdd", enabled: false },
    { scope: "agents-user", name: "docs", enabled: false },
    { scope: "repo", projectName: "WorldManager", name: "research", enabled: true }
  ]);

  assert.deepEqual(groups.map((group) => group.label), ["个人技能", "项目 · Another", "项目 · WorldManager"]);
  assert.deepEqual(groups.map((group) => [group.total, group.enabledCount]), [[2, 1], [1, 0], [2, 2]]);
  assert.deepEqual(groups[2].skills.map((skill) => skill.name), ["review", "research"]);
});

test("Skill UI gives unnamed repositories a stable visible group", () => {
  const [group] = groupSkills([{ scope: "repo", name: "demo", enabled: true }]);
  assert.equal(group.key, "project:未命名项目");
  assert.equal(group.label, "项目 · 未命名项目");
});

test("Skill group toggle plans only entries whose state differs", () => {
  const group = { skills: [
    { scope: "codex-user", sourceId: "codex-user", name: "on", enabled: true },
    { scope: "agents-user", sourceId: "agents-user", name: "off", enabled: false }
  ] };
  assert.deepEqual(groupToggleRequests(group, "local", true), [
    { sourceDeviceId: "local", scope: "agents-user", sourceId: "agents-user", name: "off", enabled: true }
  ]);
});

test("Skill group sharing preserves every source identity and one target set", () => {
  const group = { skills: [
    { scope: "repo", sourceId: "repo-one", name: "review", hash: "a".repeat(64) },
    { scope: "repo", sourceId: "repo-one", name: "tdd", hash: "b".repeat(64) }
  ] };
  const requests = groupSyncRequests(group, "windows", ["local", "mac"]);
  assert.deepEqual(requests.map((request) => [request.name, request.sourceId, request.targetDeviceIds]), [
    ["review", "repo-one", ["local", "mac"]], ["tdd", "repo-one", ["local", "mac"]]
  ]);
});

test("Skill group operations stay sequential and report partial failure", async () => {
  const order = [];
  const result = await runGroupRequests([{ name: "first" }, { name: "second" }, { name: "third" }], async ({ name }) => {
    order.push(`start:${name}`);
    await Promise.resolve();
    order.push(`end:${name}`);
    if (name === "second") throw new Error("failed");
    return name;
  });
  assert.deepEqual(order, ["start:first", "end:first", "start:second", "end:second", "start:third", "end:third"]);
  assert.deepEqual([result.total, result.succeeded, result.failed], [3, 2, 1]);
});

test("Skill group sharing recognizes an item-level target failure", () => {
  assert.equal(syncResultHasFailures({ converged: true, results: [{ status: "applied" }] }), false);
  assert.equal(syncResultHasFailures({ converged: false, results: [{ status: "applied" }, { status: "error" }] }), true);
  assert.equal(syncResultHasFailures({ results: [{ status: "error" }] }), true);
});

test("Skill group controls expose mixed state without stealing the group disclosure click", () => {
  const controls = createGroupControls({
    documentRef: { createElement: (tagName) => new FakeElement(tagName) },
    group: { key: "project:WorldManager", kind: "project", label: "项目 · WorldManager", total: 2, enabledCount: 1 },
    entry: { device: { id: "windows" } },
    devices: [{ status: "connected", device: { id: "windows" } }, { status: "connected", device: { id: "local" } }]
  });
  const input = controls.children[0].children[0];
  const button = controls.children[1];
  assert.equal(input.checked, false);
  assert.equal(input.indeterminate, true);
  assert.equal(input.dataset.groupKey, "project:WorldManager");
  assert.equal(button.textContent, "共享全部");
  assert.equal(button.disabled, false);
  let stopped = 0;
  controls.listeners.click({ stopPropagation() { stopped += 1; } });
  assert.equal(stopped, 1);
});
