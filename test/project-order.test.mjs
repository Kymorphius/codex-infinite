import assert from "node:assert/strict";
import test from "node:test";
import { buildNativeProjectOrder, matchProjectForTask, projectMovePlan } from "../src/project-order.mjs";

const projects = [
  { id: "parent", name: "Parent", position: 0, roots: [{ path: "/work" }] },
  { id: "multi", name: "Multi", position: 1, roots: [{ path: "/apps/ios" }, { path: "/apps/android" }] },
  { id: "nested", name: "Nested", position: 2, roots: [{ path: "/work/nested" }] },
  { id: "idle", name: "Idle", position: 3, roots: [{ path: "/idle" }] }
];

test("task matching supports multiple roots and prefers the longest containing root", () => {
  assert.equal(matchProjectForTask(projects, { cwd: "/apps/android/client" }).id, "multi");
  assert.equal(matchProjectForTask(projects, { cwd: "/work/nested/src" }).id, "nested");
  assert.equal(matchProjectForTask(projects, { cwd: "/unknown" }), null);
});

test("Windows extended drive paths match native roots regardless of calculation host", () => {
  const windows = [
    { id: "parent", roots: [{ path: "D:\\333.开发" }] },
    { id: "nested", roots: [{ path: "D:\\333.开发\\WorldManager" }] }
  ];
  assert.equal(matchProjectForTask(windows, { cwd: "\\\\?\\D:\\333.开发\\WorldManager\\src" }).id, "nested");
  assert.equal(matchProjectForTask(windows, { cwd: "d:/333.开发/worldmanager" }).id, "nested");
  assert.equal(matchProjectForTask(windows, { cwd: "D:\\333.开发-extra\\WorldManager" }), null);
  assert.equal(matchProjectForTask(windows, { cwd: "D:WorldManager" }), null);
  assert.equal(matchProjectForTask(windows, { cwd: "/333.开发/WorldManager" }), null);
  assert.equal(matchProjectForTask([{ id: "extended", roots: [{ path: "\\\\?\\D:\\repo" }] }], { cwd: "D:\\repo\\..data" }).id, "extended");
});

test("Windows UNC and extended UNC paths match only their own share and root", () => {
  const shares = [{ id: "share", roots: [{ path: "\\\\server\\share\\repo" }] }];
  assert.equal(matchProjectForTask(shares, { cwd: "\\\\?\\UNC\\SERVER\\share\\repo\\src" }).id, "share");
  assert.equal(matchProjectForTask(shares, { cwd: "\\\\server\\other\\repo" }), null);
  assert.equal(matchProjectForTask(shares, { cwd: "\\\\server\\share\\repo-other" }), null);
});

test("Windows namespaced sessions contribute to native priority ordering", () => {
  const windows = [
    { id: "idle", position: 0, roots: [{ path: "D:\\idle" }] },
    { id: "active", position: 1, roots: [{ path: "D:\\active" }] }
  ];
  const ordered = buildNativeProjectOrder(windows, [
    { cwd: "\\\\?\\D:\\active", createdAt: "2026-09-05T10:00:00Z", updatedAt: "2026-09-05T11:59:00Z", status: "completed" }
  ], new Date("2026-09-05T12:00:00Z"));
  assert.deepEqual(ordered.map(({ project }) => project.id), ["active", "idle"]);
  assert.ok(ordered[0].score.priorityScore > 0);
  assert.equal(ordered[1].score, null);
});

test("native projects use the existing priority score and keep idle native order", () => {
  const now = new Date("2026-08-30T12:00:00Z");
  const tasks = [
    { cwd: "/work/repo", createdAt: "2026-08-20T10:00:00Z", updatedAt: "2026-08-20T11:00:00Z", status: "completed" },
    { cwd: "/apps/ios", createdAt: "2026-08-30T10:00:00Z", updatedAt: "2026-08-30T11:59:00Z", status: "completed" }
  ];
  const order = buildNativeProjectOrder(projects, tasks, now);
  assert.deepEqual(order.map((entry) => entry.project.id), ["multi", "parent", "nested", "idle"]);
  assert.ok(order[0].score.priorityScore > order[1].score.priorityScore);
  assert.equal(order[2].score, null);
  assert.equal(order[3].score, null);
});

test("move plan is empty for the native order and rebuilds changes from the tail", () => {
  assert.deepEqual(projectMovePlan(projects, projects), []);
  const desired = [projects[1], projects[0], projects[2], projects[3]];
  assert.deepEqual(projectMovePlan(projects, desired), [
    { projectId: "idle", beforeProjectId: null },
    { projectId: "nested", beforeProjectId: "idle" },
    { projectId: "parent", beforeProjectId: "nested" },
    { projectId: "multi", beforeProjectId: "parent" }
  ]);
});
