import test from "node:test";
import assert from "node:assert/strict";
import {
  buildNativeSidebarLabelsInjectionScript,
  buildNativeSidebarLabelsSnapshotScript,
  NativeSidebarLabelService,
  normalizeNativeSidebarLabelItems,
  projectCurrentNativeSidebarLabels,
  projectNativeSidebarLabels
} from "../src/native-sidebar-labels.mjs";

const localId = "01a05852-9f3a-77b2-8ad3-74aa8e49c7c3";
const remoteId = "01a056a4-5433-7e90-81f5-a19aae7642c5";

test("sidebar labels prefer current project names and distinguish local from remote devices", () => {
  assert.deepEqual(projectNativeSidebarLabels({ tasks: [
    { id: localId, project: "mulitca", projectDisplayName: "控制台", device: { kind: "local-codex", name: "Matrix Mac" } },
    { id: remoteId, project: "pavoice", device: { kind: "remote-codex", name: "Windows-PC" } }
  ] }), [
    { threadId: localId, projectLabel: "控制台", deviceLabel: "本地" },
    { threadId: remoteId, projectLabel: "pavoice", deviceLabel: "Windows-PC" }
  ]);
});

test("sidebar label projection rejects invalid ids and bounds untrusted display text", () => {
  const labels = projectNativeSidebarLabels({ tasks: [
    { id: "not-a-thread", project: "ignored", device: { kind: "local-codex" } },
    { id: localId, projectDisplayName: `  项目\u0000${"名".repeat(90)}  `, device: { kind: "remote-codex", name: `设备${"名".repeat(90)}` } }
  ] });
  assert.equal(labels.length, 1);
  assert.equal(labels[0].projectLabel.includes("\u0000"), false);
  assert.equal(labels[0].projectLabel.length, 80);
  assert.equal(labels[0].deviceLabel.length, 80);
  assert.deepEqual(normalizeNativeSidebarLabelItems([{ threadId: "bad", projectLabel: "p", deviceLabel: "d" }]), []);
});

test("sidebar label service caches reads and refreshes dynamic project names", async () => {
  let now = 1_000;
  let projectDisplayName = "旧名称";
  let reads = 0;
  const service = new NativeSidebarLabelService({
    adapter: { async listTasks() { reads += 1; return { tasks: [{ id: localId, project: "stable", projectDisplayName, device: { kind: "local-codex" } }] }; } },
    cacheMs: 100,
    clock: () => now
  });
  assert.equal((await service.read())[0].projectLabel, "旧名称");
  projectDisplayName = "新名称";
  assert.equal((await service.read())[0].projectLabel, "旧名称");
  now += 101;
  assert.equal((await service.read())[0].projectLabel, "新名称");
  assert.equal(reads, 2);
});

test("sidebar labels return local metadata without waiting for a slow remote snapshot", async () => {
  let releaseRemote;
  const remote = new Promise((resolve) => { releaseRemote = resolve; });
  const service = new NativeSidebarLabelService({
    localAdapter: { async listTasks() { return { tasks: [{ id: localId, project: "local", device: { kind: "local-codex" } }] }; } },
    adapter: { async listTasks() { return remote; } }
  });
  const snapshot = await service.read();
  assert.deepEqual(snapshot, [{ threadId: localId, projectLabel: "local", deviceLabel: "本地" }]);
  releaseRemote({ tasks: [{ id: remoteId, project: "remote", device: { kind: "remote-codex", name: "Windows-PC" } }] });
  await service.refreshFederated();
  assert.equal((await service.read())[0].deviceLabel, "Windows-PC");
});

test("sidebar labels include old native threads and prefer current project membership", async () => {
  const oldId = "01a04445-8d03-7243-a4d3-181180bb626d";
  const lookup = {
    entries() {
      return [
        { threadId: localId, cwd: "/workspace/old", projectId: "new", projectName: "新项目" },
        { threadId: oldId, cwd: "D:\\archive\\旧会话", projectId: null, projectName: null }
      ];
    }
  };
  assert.deepEqual(projectCurrentNativeSidebarLabels(lookup), [
    { threadId: localId, projectLabel: "新项目", deviceLabel: "本地" },
    { threadId: oldId, projectLabel: "旧会话", deviceLabel: "本地" }
  ]);
  const service = new NativeSidebarLabelService({
    adapter: { async listTasks() { return { tasks: [{ id: localId, projectDisplayName: "旧项目", device: { kind: "local-codex" } }] }; } },
    currentThreadProjectIndex: { async readAll() { return lookup; } }
  });
  assert.deepEqual(await service.read(), [
    { threadId: localId, projectLabel: "新项目", deviceLabel: "本地" },
    { threadId: oldId, projectLabel: "旧会话", deviceLabel: "本地" }
  ]);
});

test("later authoritative labels survive the bounded federated merge", async () => {
  const threadId = (index) => `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
  const currentId = threadId(0);
  const federatedTasks = Array.from({ length: 800 }, (_, index) => ({
    id: threadId(index),
    projectDisplayName: `federated-${index}`,
    device: { kind: "remote-codex", name: "远端" }
  }));
  const currentEntries = [
    { threadId: currentId, cwd: "/workspace/current", projectId: "current", projectName: "当前项目" },
    ...Array.from({ length: 100 }, (_, index) => ({
      threadId: threadId(1_000 + index),
      cwd: `/workspace/local-${index}`,
      projectId: `local-${index}`,
      projectName: `本机-${index}`
    }))
  ];
  const service = new NativeSidebarLabelService({
    adapter: { async listTasks() { return { tasks: federatedTasks }; } },
    currentThreadProjectIndex: { async readAll() { return { entries: () => currentEntries }; } }
  });

  const snapshot = await service.refreshFederated();

  assert.equal(snapshot.length, 800);
  assert.deepEqual(snapshot.find((item) => item.threadId === currentId), {
    threadId: currentId,
    projectLabel: "当前项目",
    deviceLabel: "本地"
  });
});

test("native sidebar injection decorates existing thread entries without reordering them", () => {
  const source = buildNativeSidebarLabelsInjectionScript();
  assert.match(source, /data-app-action-sidebar-thread-id/);
  assert.match(source, /data-codex-control-console-sidebar-labels/);
  assert.match(source, /projectLabel/);
  assert.match(source, /deviceLabel/);
  assert.match(source, /MutationObserver/);
  assert.match(source, /function labelHost\(marker\)/);
  assert.match(source, /data-thread-title-trigger="true"/);
  assert.match(source, /titleTrigger\?\.parentElement/);
  assert.match(source, /titleRow !== marker/);
  assert.match(source, /\) \|\| null;/);
  assert.match(source, /requestAnimationFrame/);
  assert.match(source, /min-width:36px/);
  assert.match(source, /box-sizing:border-box/);
  assert.match(source, /generated-labels-v2/);
  assert.match(source, /data-codex-control-console-project-label/);
  assert.match(source, /data-codex-control-console-device-label/);
  assert.match(source, /content:attr\(/);
  assert.match(source, /order:100;max-width:64px;margin-left:auto/);
  assert.match(source, /order:101;max-width:58px;margin-left:3px/);
  assert.doesNotMatch(source, /replaceChildren\(/);
  assert.doesNotMatch(source, /host\.append\(/);
  assert.doesNotMatch(source, /setTimeout\(render/);
  assert.doesNotMatch(source, /appendChild\(marker\)/);
  assert.doesNotMatch(source, /insertBefore\(marker/);
  const snapshot = buildNativeSidebarLabelsSnapshotScript([{ threadId: localId, projectLabel: "控制台", deviceLabel: "本地" }]);
  assert.match(snapshot, /__codexControlConsoleSetSidebarLabels/);
  assert.match(snapshot, /控制台/);
  assert.match(snapshot, /本地/);
});
