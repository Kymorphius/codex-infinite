import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NativeProjectSidebarRegistry, registerNativeSidebarProjectState } from "../src/native-project-sidebar-registry.mjs";

test("native sidebar registry creates the legacy project bridge and native thread assignments", () => {
  const home = "/Users/example/.codex";
  const result = registerNativeSidebarProjectState({}, {
    codexHome: home, serverProjectId: "server-project", projectName: "真仙幸存者",
    rootPath: "/work/真仙幸存者", threadIds: ["thread-one"], now: 123, legacyProjectId: "legacy-project"
  });
  assert.deepEqual(result.state["local-projects"]["legacy-project"], {
    id: "legacy-project", name: "真仙幸存者", rootPaths: ["/work/真仙幸存者"], createdAt: 123, updatedAt: 123
  });
  assert.equal(result.state["app-server-project-id-by-legacy-project-id-by-host"][`local:${home}`]["legacy-project"], "server-project");
  assert.deepEqual(result.state["thread-project-assignments"]["thread-one"], { projectKind: "local", projectId: "legacy-project" });
});

test("native sidebar registry writes the same public project id into source and wrapper homes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "native-project-registry-"));
  const homes = [path.join(root, "source"), path.join(root, "wrapper")];
  const registry = new NativeProjectSidebarRegistry({ homes, now: () => 456, randomUUID: () => "shared-project" });
  await registry.register({ serverProjectId: "server-project", projectName: "Demo", rootPath: path.join(root, "demo"), threadIds: ["thread"] });
  for (const home of homes) {
    const state = JSON.parse(await fs.readFile(path.join(home, ".codex-global-state.json"), "utf8"));
    assert.equal(state["local-projects"]["shared-project"].name, "Demo");
    assert.equal(state["app-server-project-id-by-legacy-project-id-by-host"][`local:${home}`]["shared-project"], "server-project");
  }
});

test("native sidebar registry places the project, rather than a copied thread, in the native collaboration section", () => {
  const account = "account";
  const result = registerNativeSidebarProjectState({
    "electron-persisted-atom-state": { "sidebar-custom-sections-v3": { [account]: {
      sections: [{ id: "collaboration-profile", name: "协同", hostSectionIds: { local: "old" }, itemKeys: ["codex:thread:local:thread-one"], appearance: null }],
      collapsedSectionIds: ["collaboration-profile"], sectionOrder: ["threads", "custom:collaboration-profile"]
    } } }
  }, {
    codexHome: "/home", serverProjectId: "server", projectName: "Demo", rootPath: "/work/demo",
    threadIds: ["thread-one"], collaborationSectionId: "native-section", legacyProjectId: "project", now: 1
  });
  const profile = result.state["electron-persisted-atom-state"]["sidebar-custom-sections-v3"][account];
  assert.deepEqual(profile.sections[0].itemKeys, ["codex:project:project"]);
  assert.equal(profile.sections[0].hostSectionIds.local, "native-section");
  assert.deepEqual(profile.collapsedSectionIds, []);
  assert.deepEqual(profile.sectionOrder, ["custom:collaboration-profile", "threads"]);
});
