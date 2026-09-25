import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceNativeTabClickSequence,
  advanceNativeWheelMomentum,
  adjacentNativeConversationTabKey,
  buildNativeConversationTabsInjectionSource,
  NativeConversationTabState,
  normalizeNativeConversationTab,
  normalizeNativeConversationTabHistory,
  resolveNativeLocalConversationId
} from "../src/native-conversation-tabs.mjs";

const localOne = { kind: "local", id: "01a065ff-1594-7e41-8163-44edff7ba28b", title: "本地会话" };
const localTwo = { kind: "local", id: "01a05852-9f3a-77b2-8ad3-74aa8e49c7c3", title: "第二个会话" };
const chatgpt = { kind: "chatgpt", id: "6a945edf-1a5c-83e8-8259-fbaddce63cf6", title: "普通聊天" };
const remote = { kind: "remote", id: "task/one", deviceId: "windows pc", title: "远端会话", deviceName: "Windows Desktop" };

test("native conversation tabs use exact local and device-scoped remote identities", () => {
  assert.equal(normalizeNativeConversationTab(localOne).key, `local:${localOne.id}`);
  assert.equal(normalizeNativeConversationTab(chatgpt).key, `chatgpt:${chatgpt.id}`);
  assert.equal(normalizeNativeConversationTab(remote).key, "remote:windows%20pc/task%2Fone");
  assert.equal(normalizeNativeConversationTab({ ...remote, deviceId: "other" }).key, "remote:other/task%2Fone");
  assert.equal(normalizeNativeConversationTab({ kind: "local", id: "not-a-thread" }), null);
  assert.equal(normalizeNativeConversationTab({ kind: "chatgpt", id: "not-a-chat" }), null);
  assert.equal(normalizeNativeConversationTab({ kind: "remote", id: "task", deviceId: "" }), null);
});

test("native conversation tabs keep ChatGPT and Codex identities distinct", () => {
  const state = new NativeConversationTabState();
  state.open({ ...localOne, id: chatgpt.id });
  state.open(chatgpt);
  state.open({ ...chatgpt, title: "更新后的聊天标题" });
  assert.equal(state.tabs.length, 2);
  assert.deepEqual(state.tabs.map((tab) => tab.key), [`local:${chatgpt.id}`, `chatgpt:${chatgpt.id}`]);
  assert.equal(state.active().title, "更新后的聊天标题");
});

test("native conversation tab history is bounded, deduplicated, and restorable", () => {
  const tabs = [
    localOne,
    { ...localOne, title: "重复项" },
    chatgpt,
    ...Array.from({ length: 45 }, (_, index) => ({ kind: "remote", id: `task-${index}`, deviceId: "windows", title: `远端 ${index}` }))
  ];
  const history = normalizeNativeConversationTabHistory({ tabs, activeKey: `chatgpt:${chatgpt.id}`, consoleModule: "sessions", dismissedLocalKeys: [`local:${localOne.id}`, `LOCAL:${localTwo.id}`, `local:${localTwo.id}`, "remote:ignored"] });
  assert.equal(history.tabs.length, 40);
  assert.equal(history.tabs[0].title, localOne.title);
  assert.equal(history.activeKey, `chatgpt:${chatgpt.id}`);
  assert.deepEqual(history.dismissedLocalKeys, [`local:${localTwo.id}`]);
  const restored = new NativeConversationTabState(history);
  assert.equal(restored.tabs.length, 40);
  assert.equal(restored.active().kind, "chatgpt");
  assert.equal(restored.showConsole().module, "sessions");
  assert.deepEqual(normalizeNativeConversationTabHistory({ tabs: [{ kind: "bad" }], activeKey: "unknown", consoleModule: "bad" }), { tabs: [], activeKey: "console", consoleModule: "board", wheelDirection: "standard", dismissedLocalKeys: [] });
});

test("closed local tabs ignore automatic history sync until explicitly reopened", () => {
  const state = new NativeConversationTabState();
  state.open(localOne);
  state.close(`local:${localOne.id}`);
  assert.deepEqual(state.dismissedLocalKeys, [`local:${localOne.id}`]);
  assert.equal(state.open(localOne, { explicit: false }), null);
  assert.equal(state.tabs.length, 0);
  assert.equal(state.open(localOne, { explicit: true }).key, `local:${localOne.id}`);
  assert.deepEqual(state.dismissedLocalKeys, []);
  assert.equal(state.tabs.length, 1);
});

test("native conversation tabs deduplicate while refreshing the label", () => {
  const state = new NativeConversationTabState();
  state.open(localOne);
  state.open({ ...localOne, title: "更新后的标题" });
  state.open(remote);
  state.open(remote);
  assert.equal(state.tabs.length, 2);
  assert.equal(state.tabs[0].title, "更新后的标题");
  assert.equal(state.active().kind, "remote");
});

test("activating a remembered conversation moves it to the recent end", () => {
  const state = new NativeConversationTabState();
  state.open(localOne);
  state.open(localTwo);
  state.open(remote);
  state.open({ ...localOne, title: "最近查看的本地会话" });
  assert.deepEqual(state.tabs.map((tab) => tab.key), [
    `local:${localTwo.id}`,
    normalizeNativeConversationTab(remote).key,
    `local:${localOne.id}`
  ]);
  assert.equal(state.active().title, "最近查看的本地会话");
});

test("native conversation tabs retain the last console module", () => {
  const state = new NativeConversationTabState();
  assert.equal(state.showConsole("priority").module, "priority");
  state.open(localOne);
  assert.equal(state.activate("console").module, "priority");
  assert.equal(state.showConsole("unsupported").module, "priority");
});

test("closing the active native page returns to Console", () => {
  const state = new NativeConversationTabState();
  state.open(localOne);
  state.open(localTwo);
  state.open(remote);
  state.activate(`local:${localTwo.id}`);
  assert.equal(state.close(`local:${localTwo.id}`).kind, "console");
  assert.deepEqual(state.tabs.map((tab) => tab.key), [`local:${localOne.id}`, normalizeNativeConversationTab(remote).key]);
});

test("closing an inactive tab does not change the active native view", () => {
  const state = new NativeConversationTabState();
  state.open(localOne);
  state.open(remote);
  assert.equal(state.close(`local:${localOne.id}`).kind, "remote");
  assert.equal(state.active().id, remote.id);
});

test("drag ordering preserves the active native tab", () => {
  const state = new NativeConversationTabState();
  state.open(localOne); state.open(localTwo); state.open(remote);
  const active = state.active();
  state.move(normalizeNativeConversationTab(remote).key, `local:${localOne.id}`, false);
  assert.deepEqual(state.tabs.map((tab) => tab.key), [normalizeNativeConversationTab(remote).key, `local:${localOne.id}`, `local:${localTwo.id}`]);
  assert.equal(state.active().key, active.key);
});

test("wheel adjacency wraps between the permanent Console and final conversation", () => {
  const tabs = [normalizeNativeConversationTab(localOne), normalizeNativeConversationTab(localTwo), normalizeNativeConversationTab(remote)];
  assert.equal(adjacentNativeConversationTabKey(tabs, "console", -1), normalizeNativeConversationTab(remote).key);
  assert.equal(adjacentNativeConversationTabKey(tabs, "console", 1), `local:${localOne.id}`);
  assert.equal(adjacentNativeConversationTabKey(tabs, `local:${localTwo.id}`, -1), `local:${localOne.id}`);
  assert.equal(adjacentNativeConversationTabKey(tabs, `local:${localTwo.id}`, 1), normalizeNativeConversationTab(remote).key);
  assert.equal(adjacentNativeConversationTabKey(tabs, normalizeNativeConversationTab(remote).key, 1), "console");
  assert.equal(adjacentNativeConversationTabKey([], "console", -1), "console");
});

test("native tab history persists a normalized wheel direction", () => {
  assert.equal(normalizeNativeConversationTabHistory({ wheelDirection: "reversed" }).wheelDirection, "reversed");
  assert.equal(normalizeNativeConversationTabHistory({ wheelDirection: "sideways" }).wheelDirection, "standard");
  const state = new NativeConversationTabState({ wheelDirection: "reversed" });
  assert.equal(state.wheelDirection, "reversed");
  assert.equal(state.setWheelDirection("invalid"), "standard");
});

test("double-click recognition survives tab rerenders and never closes Console", () => {
  const key = `local:${localOne.id}`;
  let sequence = advanceNativeTabClickSequence({}, key, 100);
  assert.equal(sequence.close, false);
  sequence = advanceNativeTabClickSequence(sequence, key, 420);
  assert.equal(sequence.close, true);
  sequence = advanceNativeTabClickSequence(sequence, key, 430);
  assert.equal(sequence.close, false);
  sequence = advanceNativeTabClickSequence(sequence, key, 1000);
  assert.equal(sequence.close, false);
  assert.equal(advanceNativeTabClickSequence(sequence, `local:${localTwo.id}`, 1100).close, false);
  sequence = advanceNativeTabClickSequence({}, "console", 100);
  assert.equal(advanceNativeTabClickSequence(sequence, "console", 200).close, false);
});

test("mounted native conversation identity wins over stale sidebar selection", () => {
  assert.equal(resolveNativeLocalConversationId([localTwo.id], `local:${localOne.id}`), localTwo.id);
  assert.equal(resolveNativeLocalConversationId(["bad", localOne.id.toUpperCase()], `local:${localTwo.id}`), localOne.id);
  assert.equal(resolveNativeLocalConversationId([], `LOCAL:${localTwo.id.toUpperCase()}`), localTwo.id);
  assert.equal(resolveNativeLocalConversationId(["bad"], "local:not-a-thread"), "");
});

test("wheel momentum filtering ignores only a decaying tail and resumes on deliberate input", () => {
  let state = advanceNativeWheelMomentum({}, 48, 10);
  state = advanceNativeWheelMomentum(state, 36, 20);
  state = advanceNativeWheelMomentum(state, 24, 30);
  state = advanceNativeWheelMomentum(state, 12, 40);
  assert.equal(state.ignoring, true);
  assert.equal(state.resetAccumulator, true);
  state = advanceNativeWheelMomentum(state, 8, 50);
  assert.equal(state.ignoring, true);
  state = advanceNativeWheelMomentum(state, -8, 60);
  assert.equal(state.ignoring, false);
  assert.equal(state.resetAccumulator, true);
  state = advanceNativeWheelMomentum({ ...state, ignoring: true, lastMagnitude: 4, lastDirection: -1 }, -16, 70);
  assert.equal(state.ignoring, false);
  state = advanceNativeWheelMomentum({ ...state, ignoring: true }, -3, 200);
  assert.equal(state.ignoring, false);
});

test("native tab injection is idempotent, route-oriented, and non-destructive", () => {
  const source = buildNativeConversationTabsInjectionSource();
  assert.match(source, /data-codex-control-console-native-tabs/);
  assert.match(source, /__codexControlConsoleConversationTabs/);
  assert.match(source, /codex-control-console\.native-tabs\.v1/);
  assert.match(source, /previous\?\.snapshot\?\.\(\)/);
  assert.match(source, /renderedTabs\.map\(renderedTab\)/);
  assert.match(source, /localStorage\.setItem\(STORAGE_KEY/);
  assert.match(source, /localStorage\.getItem\(STORAGE_KEY/);
  assert.match(source, /snapshot,/);
  assert.match(source, /dismissedLocalKeys/);
  assert.match(source, /dismissedIndex >= 0 && !explicitView/);
  assert.match(source, /closing\.kind === 'local'/);
  assert.match(source, /MAX_TABS = 40/);
  assert.match(source, /data-app-action-sidebar-thread-id\^=/);
  assert.match(source, /data-app-action-sidebar-thread-selected/);
  assert.match(source, /data-app-action-sidebar-thread-title/);
  assert.match(source, /data-above-composer-conversation-id/);
  assert.match(source, /resolveNativeLocalConversationId\(mountedIds, selectedRaw\)/);
  assert.match(source, /scheduleSync\(routeChanged\(records\)\)/);
  assert.match(source, /tab\.kind === 'local'\) \{ request\(tab, true\); return; \}/);
  assert.match(source, /transition\.matches\(key\)/);
  assert.match(source, /open\(value, false, true\)/);
  assert.match(source, /transition\.request\(key\)/);
  assert.match(source, /transition\.isPending\(\) && !explicit/);
  assert.match(source, /setTimeout\(\(\) => \{ pending = ''/);
  assert.match(source, /data-navigation-pending/);
  assert.match(source, /data-navigation-superseded/);
  assert.match(source, /data-navigation-pending\] \.ccc-native-tab-title\{opacity:\.7\}/);
  assert.match(source, /openLocal: request/);
  assert.match(source, /data-thread-title="true"/);
  assert.match(source, /openLocal/);
  assert.match(source, /openChatgpt/);
  assert.match(source, /openRemote/);
  assert.match(source, /data-window-key/);
  assert.match(source, /在新窗口打开：/);
  assert.match(source, /createNativeConversationWindowButton\(document, tab, key\)/);
  assert.match(source, /typeof openWindow !== "function"/);
  assert.match(source, /void openNativeConversationWindow\(\{state,keyFor,key:pop\.dataset\.windowKey/);
  assert.match(source, /data-window-opening/);
  assert.match(source, /data-window-error/);
  assert.match(source, /2026-09-25\.topbar-finish2/);
  assert.match(source, /consoleTab\.append\(consoleLabel\)/);
  assert.match(source, /item\.append\(label\)/);
  assert.doesNotMatch(source, /(?:consoleTab|item)\.append\((?:mark|dot),/);
  assert.match(source, /createNativeLatestNavigation\(document, window\)/);
  assert.match(source, /openNativeConversationPages/);
  assert.match(source, /installNativeRecentConversationMenu/);
  assert.match(source, /recentMenu\?\.render/);
  assert.match(source, /aria-label', '打开的页面'/);
  assert.match(source, /state\.activeKey = 'console'/);
  assert.match(source, /data-sidebar-chatgpt-conversation-key/);
  assert.match(source, /data-codex-control-console-ordinary-chat-row/);
  assert.match(source, /querySelector\?\.\('\[data-thread-title="true"\]'\)/);
  assert.match(source, /=== 'cloud-work'/);
  assert.match(source, /'chatgpt:' \+ tab\.id\.toLowerCase\(\)/);
  assert.match(source, /openConsole/);
  assert.match(source, /textContent = tab\.title/);
  assert.match(source, /-webkit-app-region:no-drag/);
  assert.match(source, /overflow-x:auto/);
  assert.match(source, /overflow:visible/);
  assert.match(source, /leftControlEdge/);
  assert.match(source, /style\.pointerEvents !== 'none'/);
  assert.match(source, /data-codex-control-console-native-title-hidden/);
  assert.match(source, /\['聊天操作', 'Chat actions'\]/);
  assert.doesNotMatch(source, /header button\[aria-label\]/);
  assert.match(source, /bounds\.top < 42/);
  assert.match(source, /titleTakeoverNodes = new Set/);
  assert.match(source, /filter\(\(node\) => node\.isConnected\)/);
  assert.match(source, /if \(!chatAction\)/);
  assert.match(source, /projectPrefixes = \['项目：', 'Project:'\]/);
  assert.match(source, /\[project, title, chatAction\]\.filter\(Boolean\)/);
  assert.match(source, /stableLeft = Math\.max\(76, Math\.round\(rect\.left \+ 8\)\)/);
  assert.match(source, /const left = stableLeft \?\?/);
  assert.match(source, /function scheduleSync\(urgent = false, forceTitleScan = false\)/);
  assert.match(source, /position\(forceTitleScan\)/);
  assert.match(source, /const onResize = \(\) => scheduleSync\(true, true\)/);
  assert.doesNotMatch(source, /position\(urgent\)/);
  assert.match(source, /render\(\); scheduleSync\(true, true\)/);
  assert.match(source, /background:var\(--color-background-primary,#202022\)/);
  assert.doesNotMatch(source, /const takeoverActive =/);
  assert.doesNotMatch(source, /installNativeConversationTabWheelPreferences/);
  assert.doesNotMatch(source, /installNativeConversationTabDragging/);
  assert.doesNotMatch(source, /advanceNativeTabClickSequence\(tabClickSequence/);
  assert.doesNotMatch(source, /addEventListener\('dblclick'/);
  assert.match(source, /item\.draggable = false/);
  assert.doesNotMatch(source, /addEventListener\(["']dragstart["']/);
  assert.doesNotMatch(source, /data-drop-position/);
  assert.doesNotMatch(source, /consoleTab\.draggable/);
  assert.match(source, /bounds\.left >= workspaceRect\.left \+ 4/);
  assert.match(source, /removeAttribute\(TITLE_HIDDEN_ATTRIBUTE\)/);
  assert.doesNotMatch(source, /archiveThread|interruptThread|deleteThread|stopThread/);
  assert.doesNotThrow(() => new Function(`(() => { ${source} })()`));
});
