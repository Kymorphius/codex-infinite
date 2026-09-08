import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createCurrentThreadProjectLookup, CurrentThreadProjectIndex } from "../src/current-thread-projects.mjs";

test("current thread lookup resolves explicit membership and deepest matching root", () => {
  const lookup = createCurrentThreadProjectLookup({
    projects: [
      { id: "parent", name: "父项目", path: "D:\\333.开发" },
      { id: "game", name: "真仙幸存者", path: "D:\\333.开发\\真仙幸存者" },
      { id: "same-name", name: "真仙幸存者", path: "D:\\other\\game" },
      { id: "legacy-alias", name: "旧名称", path: "D:\\333.开发\\真仙幸存者" }
    ],
    threads: [
      { id: "moved", cwd: "\\\\?\\D:\\333.开发\\真仙幸存者", projectId: null },
      { id: "worktree", cwd: "C:\\Users\\Admin\\.codex\\worktrees\\1\\game", projectId: "game" },
      { id: "explicit-renamed", cwd: "D:\\333.开发\\真仙幸存者", projectId: "legacy-alias" },
      { id: "implicit-worktree", cwd: "C:\\Users\\Admin\\.codex\\worktrees\\2\\真仙幸存者", projectId: null },
      { id: "namesake", cwd: "D:\\other\\game", projectId: "same-name" }
    ]
  });
  assert.deepEqual(lookup.currentFor("moved"), { cwd: "\\\\?\\D:\\333.开发\\真仙幸存者", projectId: "game", projectName: "真仙幸存者" });
  assert.deepEqual(lookup.currentFor("worktree"), { cwd: "C:\\Users\\Admin\\.codex\\worktrees\\1\\game", projectId: "game", projectName: "真仙幸存者" });
  assert.equal(lookup.currentFor("explicit-renamed").projectName, "旧名称");
  assert.equal(lookup.currentFor("implicit-worktree").projectId, "game");
  assert.equal(lookup.currentFor("namesake").projectId, "same-name");
  assert.equal(lookup.entries().length, 5);
  assert.equal(lookup.entries().find((entry) => entry.threadId === "worktree").projectName, "真仙幸存者");
});

test("current thread index bounds reads, closes the database, and falls back safely", async () => {
  let closed = false;
  const index = new CurrentThreadProjectIndex({
    databasePath: "/state.sqlite",
    databaseFactory() {
      return {
        prepare(sql) {
          return { all(...values) {
            if (sql.startsWith("SELECT id")) return [{ id: sql.includes("WHERE id IN") ? values[0] : "old-thread", cwd: "/workspace/project", projectId: "project" }];
            return [{ id: "project", name: "项目", path: "/workspace/project" }];
          } };
        },
        close() { closed = true; }
      };
    }
  });
  assert.equal((await index.read(["thread"])).currentFor("thread").projectName, "项目");
  assert.equal((await index.readAll()).currentFor("old-thread").projectName, "项目");
  assert.equal(closed, true);

  const warnings = [];
  const unavailable = new CurrentThreadProjectIndex({ databasePath: "/missing", databaseFactory() { throw new Error("locked"); }, logger: { warn(message) { warnings.push(message); } } });
  assert.equal((await unavailable.read(["thread"])).currentFor("thread"), null);
  assert.equal((await unavailable.read(["thread"])).currentFor("thread"), null);
  assert.equal(warnings.length, 1);
});

test("current thread SQLite access is explicitly read-only", async () => {
  const source = await fs.readFile(new URL("../src/current-thread-projects.mjs", import.meta.url), "utf8");
  assert.match(source, /new DatabaseSync\(this\.databasePath, \{ readOnly: true \}\)/);
  assert.doesNotMatch(source, /database\.prepare\(["`]\s*(?:INSERT|UPDATE|DELETE|REPLACE)\b/i);
});
