import test from "node:test";
import assert from "node:assert/strict";
import {
  buildNativeRemoteSidebarInjectionScript,
  buildNativeRemoteSidebarSnapshotScript,
  NativeRemoteSidebarService,
  normalizeNativeRemoteSidebarItems,
  projectNativeRemoteSidebar
} from "../src/native-remote-sidebar.mjs";

const remoteOne = { id: "windows-pc", name: "Windows Desktop", kind: "remote-codex", status: "connected" };
const remoteTwo = { id: "forest-mac", name: "MacBook Pro", kind: "remote-codex", status: "error" };

test("remote sidebar projects remote devices and groups newest conversations by current project name", () => {
  const result = projectNativeRemoteSidebar({
    devices: [{ id: "local", name: "Local", kind: "local-codex", status: "connected" }, remoteOne, remoteTwo],
    tasks: [
      { id: "new", title: "最新会话", project: "stable", projectDisplayName: "语音", cwd: "/voice", updatedAt: "2026-08-31T12:00:00Z", status: "active", device: remoteOne },
      { id: "old", title: "较早会话", project: "stable", projectDisplayName: "语音", cwd: "/voice", updatedAt: "2026-08-30T12:00:00Z", status: "completed", device: remoteOne },
      { id: "local-task", title: "不显示", project: "local", device: { id: "local", kind: "local-codex" } }
    ]
  });
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], {
    id: "windows-pc", name: "Windows Desktop", kind: "remote-codex", status: "connected", projectCount: 1, conversationCount: 2, hiddenProjectCount: 0,
    projects: [{ key: "/voice", name: "语音", sourceDirectory: "/voice", sourceDirectories: ["/voice"], conversationCount: 2, hiddenConversationCount: 0, conversations: [
      { id: "new", title: "最新会话", status: "active", updatedAt: "2026-08-31T12:00:00Z" },
      { id: "old", title: "较早会话", status: "completed", updatedAt: "2026-08-30T12:00:00Z" }
    ] }]
  });
  assert.deepEqual(result[1], {
    id: "forest-mac", name: "MacBook Pro", kind: "remote-codex", status: "offline", projectCount: 0, conversationCount: 0, hiddenProjectCount: 0, projects: []
  });
});

test("remote sidebar deduplicates threads, bounds nested collections, and sanitizes text", () => {
  const devices = Array.from({ length: 10 }, (_, index) => ({ id: `remote-${index}`, name: `设备\u0000${index}`, kind: "remote-codex", status: "connected" }));
  const tasks = [];
  for (let project = 0; project < 14; project += 1) {
    for (let thread = 0; thread < 8; thread += 1) tasks.push({
      id: `thread-${project}-${thread}`,
      title: `会话-${project}-${thread}`,
      project: `project-${project}`,
      cwd: `/project/${project}`,
      updatedAt: `2026-08-${String(30 - project).padStart(2, "0")}T12:00:0${thread}Z`,
      device: devices[0]
    });
  }
  tasks.push({ ...tasks[0], title: "重复项" });
  const result = projectNativeRemoteSidebar({ devices, tasks });
  assert.equal(result.length, 8);
  assert.equal(result[0].name.includes("\u0000"), false);
  assert.equal(result[0].projects.length, 14);
  assert.equal(result[0].hiddenProjectCount, 0);
  assert.equal(result[0].projects[0].conversations.length, 6);
  assert.equal(result[0].projects[0].hiddenConversationCount, 2);
  assert.equal(result[0].conversationCount, 112);
  assert.deepEqual(normalizeNativeRemoteSidebarItems([{ id: "", name: "bad" }]), []);
});

test("remote sidebar keeps device order stable and sorts projects by shared weight", () => {
  const now = new Date("2026-09-01T12:00:00Z");
  const result = projectNativeRemoteSidebar({
    devices: [remoteOne, remoteTwo],
    tasks: [
      { id: "newest", title: "单次最新", project: "newest", cwd: "/newest", createdAt: "2026-09-01T10:59:00Z", updatedAt: "2026-09-01T11:00:00Z", status: "completed", device: remoteOne },
      { id: "weighted-1", title: "权重一", project: "weighted", cwd: "/weighted", createdAt: "2026-08-31T08:00:00Z", updatedAt: "2026-09-01T10:30:00Z", status: "completed", device: remoteOne },
      { id: "weighted-2", title: "权重二", project: "weighted", cwd: "/weighted", createdAt: "2026-09-01T09:00:00Z", updatedAt: "2026-09-01T10:00:00Z", status: "completed", device: remoteOne }
    ]
  }, now);
  assert.deepEqual(result.map((device) => device.id), ["windows-pc", "forest-mac"]);
  assert.deepEqual(result[0].projects.map((project) => project.key), ["/weighted", "/newest"]);
  assert.deepEqual(result[0].projects[0].conversations.map((conversation) => conversation.id), ["weighted-1", "weighted-2"]);
});

test("remote sidebar merges multiple roots only when current native project ids match", () => {
  const result = projectNativeRemoteSidebar({ devices: [remoteOne], tasks: [
    { id: "main", title: "主目录", projectId: "project-one", projectDisplayName: "联动资产管理", cwd: "D:\\main", device: remoteOne },
    { id: "worktree", title: "工作树", projectId: "project-one", projectDisplayName: "联动资产管理", cwd: "D:\\worktree", device: remoteOne },
    { id: "namesake", title: "同名项目", projectId: "project-two", projectDisplayName: "联动资产管理", cwd: "D:\\other", device: remoteOne }
  ] });
  assert.equal(result[0].projects.length, 2);
  assert.deepEqual(result[0].projects.map((project) => project.conversationCount).sort((a, b) => b - a), [2, 1]);
  assert.equal(result[0].projects.find((project) => project.conversationCount === 2).name, "联动资产管理");
  assert.equal(result[0].projects.find((project) => project.conversationCount === 2).sourceDirectory, null);
});

test("remote sidebar service returns cached data immediately while refreshing federation", async () => {
  let resolveFirst;
  let reads = 0;
  const service = new NativeRemoteSidebarService({
    adapter: { listTasks() { reads += 1; return new Promise((resolve) => { resolveFirst = resolve; }); } },
    cacheMs: 100,
    clock: () => 1_000
  });
  assert.deepEqual(await service.read(), []);
  assert.equal(reads, 1);
  resolveFirst({ devices: [remoteOne], tasks: [] });
  await service.refresh();
  assert.equal((await service.read())[0].name, "Windows Desktop");
});

test("remote sidebar service retains the last project list when a device goes offline", async () => {
  let now = 1_000;
  let snapshot = {
    devices: [remoteOne],
    tasks: [{ id: "thread", title: "保留的会话", project: "demo", device: remoteOne }]
  };
  const service = new NativeRemoteSidebarService({ adapter: { async listTasks() { return snapshot; } }, cacheMs: 10, clock: () => now });
  await service.read();
  await service.refresh();
  snapshot = { devices: [{ ...remoteOne, status: "error" }], tasks: [] };
  now += 11;
  await service.read();
  await service.refresh();
  assert.equal((await service.read())[0].status, "offline");
  assert.equal((await service.read())[0].conversationCount, 1);
  assert.equal((await service.read())[0].projects[0].conversations[0].title, "保留的会话");
});

test("remote sidebar injection owns one ordered subtree above cloud work and preserves expansion sets", () => {
  const source = buildNativeRemoteSidebarInjectionScript();
  assert.match(source, /data-codex-control-console-remote-sidebar/);
  assert.match(source, /nativeSectionHeader\('远端'/);
  assert.doesNotMatch(source, /label: '协同'/);
  assert.match(source, /项目|Projects/);
  assert.match(source, /root\.style\.order = '65'/);
  assert.match(source, /querySelectorAll\(ROOT_SELECTOR\).*node !== root.*node\.remove\(\)/s);
  assert.match(source, /insertBefore\(root, nativeProjectsWrapper\)/);
  assert.match(source, /expandedDevices/);
  assert.match(source, /expandedProjects/);
  assert.match(source, /expandedProjectLists/);
  assert.match(source, /INITIAL_VISIBLE_PROJECTS = 12/);
  assert.match(source, /显示另外/);
  assert.match(source, /收起到前/);
  assert.match(source, /aria-expanded/);
  assert.match(source, /hiddenConversationCount/);
  assert.match(source, /function nativeTypography\(\)/);
  assert.match(source, /createElementNS\(namespace, 'svg'\)/);
  assert.match(source, /getComputedStyle/);
  assert.match(source, /data-app-action-sidebar-project-row/);
  assert.match(source, /data-app-action-sidebar-thread-id.*text-base/);
  assert.match(source, /thread-selected="true"/);
  assert.match(source, /function nativeTemplates\(\)/);
  assert.match(source, /templatesSignature/);
  assert.match(source, /headingClass/);
  assert.match(source, /projectClass/);
  assert.match(source, /threadClass/);
  assert.match(source, /projectContent/);
  assert.match(source, /threadContent/);
  assert.match(source, /data-codex-control-console-sidebar-labels/);
  assert.match(source, /projectIcon/);
  assert.match(source, /function deviceIcon\(\)/);
  assert.match(source, /setAttribute\('role', 'button'\)/);
  assert.match(source, /aria-disabled/);
  assert.match(source, /__codexControlConsoleOpenRemoteConversation/);
  assert.match(source, /data-codex-control-console-session-entry/);
  assert.match(source, /data-codex-control-console-frame/);
  assert.doesNotMatch(source, /__codexControlConsoleOpenNativeThread/);
  assert.doesNotMatch(source, /collaboration-codex/);
  assert.match(source, /复制项目到本机/);
  assert.match(source, /复制会话 ID/);
  assert.match(source, /openConversationMenu/);
  assert.match(source, /copyRemoteThreadId\(conversation\.id\)/);
  assert.match(source, /navigator\.clipboard\.writeText/);
  assert.match(source, /document\.execCommand\('copy'\)/);
  assert.match(source, /contextmenu/);
  assert.match(source, /__codexControlConsoleCopyRemoteProject/);
  assert.match(source, /sourceDirectory: project\.sourceDirectory/);
  assert.match(source, /id: conversation\.id, deviceId: device\.id/);
  assert.match(source, /title: conversation\.title, cwd: project\.sourceDirectory, deviceName: device\.name/);
  assert.match(source, /data-app-action-sidebar-thread-selected/);
  assert.match(source, /aria-current', 'page'/);
  assert.match(source, /__codexControlConsoleSelectedRemoteConversation/);
  assert.match(source, /data-codex-control-console-remote-thread-selected/);
  assert.match(source, /background-color:transparent!important/);
  assert.match(source, /removeAttribute\(REMOTE_SELECTED_ATTRIBUTE\)/);
  assert.match(source, /token !== 'bg-primary-ghost-hover'/);
  assert.doesNotMatch(source, /row\.style\.background/);
  assert.match(source, /设备离线，暂时无法打开/);
  assert.match(source, /var\(--color-text\)/);
  assert.match(source, /var\(--color-text-tertiary\)/);
  assert.match(source, /MutationObserver/);
  assert.doesNotMatch(source, /appendChild\(nativeProjects/);
  assert.doesNotMatch(source, /insertBefore\(nativeProjects/);
  assert.doesNotThrow(() => new Function(source));
  const snapshot = buildNativeRemoteSidebarSnapshotScript([{ id: "windows-pc", name: "Windows Desktop", status: "connected", projects: [] }]);
  assert.match(snapshot, /__codexControlConsoleSetRemoteSidebar/);
  assert.match(snapshot, /Windows Desktop/);
});
