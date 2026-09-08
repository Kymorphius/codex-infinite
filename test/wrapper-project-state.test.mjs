import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mergeWrapperProjectState, orderWrapperProjectState, repairWrapperProjectState } from "../src/wrapper-project-state.mjs";

const sourceHome = "/Users/demo/.codex";
const wrapperHome = "/Users/demo/.codex-control-console";
const sourceHost = `local:${path.posix.resolve(sourceHome)}`;
const wrapperHost = `local:${path.posix.resolve(wrapperHome)}`;

function sourceState() {
  return {
    "local-projects": { legacy: { id: "legacy", name: "看板", rootPaths: ["/work/kanban"] } },
    "selected-project": { type: "local", projectId: "legacy" },
    "electron-saved-workspace-roots": ["/work/kanban"],
    "app-server-project-id-by-legacy-project-id-by-host": { [sourceHost]: { legacy: "server-project" } },
    "app-server-projects-migration-by-host": { [sourceHost]: { version: 1, projectsMigrated: true } }
  };
}

test("project bootstrap repair remaps host state and preserves wrapper-only projects", () => {
  const target = {
    "local-projects": { private: { id: "private", name: "Wrapper only", rootPaths: ["/work/private"] } },
    "app-server-project-id-by-legacy-project-id-by-host": { [wrapperHost]: { private: "private-server" } }
  };
  const result = mergeWrapperProjectState(sourceState(), target, { sourceHome, wrapperHome });
  assert.equal(result.changed, true);
  assert.deepEqual(Object.keys(result.state["local-projects"]), ["private", "legacy"]);
  assert.deepEqual(result.state["app-server-project-id-by-legacy-project-id-by-host"][wrapperHost], {
    private: "private-server", legacy: "server-project"
  });
  assert.deepEqual(result.state["app-server-projects-migration-by-host"][wrapperHost], {
    version: 1, projectsMigrated: true
  });
  assert.equal(result.state["selected-project"].projectId, "legacy");
});

test("project bootstrap is a no-op without source projects", () => {
  const target = { "local-projects": { keep: { id: "keep" } } };
  const result = mergeWrapperProjectState({}, target, { sourceHome, wrapperHome });
  assert.equal(result.changed, false);
  assert.equal(result.state, target);
});

test("project bootstrap persists atomically with private permissions", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wrapper-project-state-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "source");
  const wrapper = path.join(root, "wrapper");
  await fs.mkdir(source);
  await fs.mkdir(wrapper);
  const state = sourceState();
  state["app-server-project-id-by-legacy-project-id-by-host"] = { [`local:${source}`]: { legacy: "server-project" } };
  state["app-server-projects-migration-by-host"] = { [`local:${source}`]: { version: 1, projectsMigrated: true } };
  await fs.writeFile(path.join(source, ".codex-global-state.json"), JSON.stringify(state));
  const result = await repairWrapperProjectState({ sourceHome: source, wrapperHome: wrapper });
  const saved = JSON.parse(await fs.readFile(path.join(wrapper, ".codex-global-state.json"), "utf8"));
  assert.deepEqual(result, { changed: true, projectCount: 1 });
  assert.equal(saved["app-server-project-id-by-legacy-project-id-by-host"][`local:${wrapper}`].legacy, "server-project");
  if (process.platform !== "win32") assert.equal((await fs.stat(path.join(wrapper, ".codex-global-state.json"))).mode & 0o777, 0o600);
});

test("invalid target state fails closed", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wrapper-project-invalid-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "source");
  const wrapper = path.join(root, "wrapper");
  await fs.mkdir(source);
  await fs.mkdir(wrapper);
  await fs.writeFile(path.join(source, ".codex-global-state.json"), JSON.stringify(sourceState()));
  await fs.writeFile(path.join(wrapper, ".codex-global-state.json"), "not-json");
  await assert.rejects(repairWrapperProjectState({ sourceHome: source, wrapperHome: wrapper }), /无法读取 Codex 项目状态/);
  assert.equal(await fs.readFile(path.join(wrapper, ".codex-global-state.json"), "utf8"), "not-json");
});

test("wrapper bootstrap project keys follow app-server order without changing values", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wrapper-project-order-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const wrapper = path.join(root, "wrapper");
  await fs.mkdir(wrapper);
  const host = `local:${wrapper}`;
  const state = {
    "local-projects": { first: { name: "First" }, idle: { name: "Idle" }, recent: { name: "Recent" } },
    "app-server-project-id-by-legacy-project-id-by-host": {
      [host]: { first: "server-first", recent: "server-recent" }
    }
  };
  await fs.writeFile(path.join(wrapper, ".codex-global-state.json"), JSON.stringify(state));
  const result = await orderWrapperProjectState({ wrapperHome: wrapper, serverProjectIds: ["server-recent", "server-first"] });
  const saved = JSON.parse(await fs.readFile(path.join(wrapper, ".codex-global-state.json"), "utf8"));
  assert.deepEqual(result, { changed: true, projectCount: 3 });
  assert.deepEqual(Object.keys(saved["local-projects"]), ["recent", "first", "idle"]);
  assert.deepEqual(saved["local-projects"].recent, { name: "Recent" });
});
