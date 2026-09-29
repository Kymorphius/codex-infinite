import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { buildNativeConversationTabsInjectionSource } from "../src/native-conversation-tabs.mjs";
import { buildNativeProviderNavigationSource } from "../src/native-terminal-navigation.mjs";
import { findNativeEntryAnchor, nativeEntryMutationNeedsInstall, nativeLayoutTransition } from "../src/native-entry-probe.mjs";
import {
  buildInjectionScript,
  injectionDecision,
  CONTROL_ENTRY_ATTRIBUTE,
  KANBAN_ENTRY_ATTRIBUTE,
  SESSION_ENTRY_ATTRIBUTE,
  PRIORITY_ENTRY_ATTRIBUTE
} from "../src/injection.mjs";

test("injection decision is idempotent once the marker exists", () => {
  assert.equal(injectionDecision({ hasEntry: true, hasAnchor: true }), "already-installed");
  assert.equal(injectionDecision({ hasEntry: false, hasAnchor: true }), "install-native-entry");
  assert.equal(injectionDecision({ hasEntry: false, hasAnchor: false }), "wait-for-native-entry");
});

test("content-only mutations do not rescan native entries, but host remounts still do", () => {
  const content = { closest: () => ({}) };
  const host = { closest: () => null };
  assert.equal(nativeEntryMutationNeedsInstall([{ target: content }, { target: content }]), false);
  assert.equal(nativeEntryMutationNeedsInstall([{ target: content }, { target: host }]), true);
  assert.equal(nativeEntryMutationNeedsInstall([{ target: host }]), true);
  assert.equal(nativeEntryMutationNeedsInstall([]), true);
  const source = buildInjectionScript("http://127.0.0.1:47831");
  assert.match(source, /if \(!nativeEntryMutationNeedsInstall\(records\)\) return/);
  assert.match(source, /subscriber\(records\); \} catch \{\} \}\s+if \(!nativeEntryMutationNeedsInstall/);
});

test("native entry anchor lookup retains its original label selection", () => {
  const unrelated = { innerText: '设置' }, anchor = { innerText: '插件' };
  assert.equal(findNativeEntryAnchor({ querySelectorAll: () => [unrelated, anchor] }, value => value.trim()), anchor);
});

test("serialized native anchor probe has no module-scope dependencies", () => {
  const anchor = { textContent: '插件' };
  const context = vm.createContext({ document: { querySelectorAll: () => [anchor] } });
  assert.equal(vm.runInContext(`(${findNativeEntryAnchor.toString()})(document, value => value.trim())`, context), anchor);
});

test("native entry anchor lookup never reads layout for ordinary buttons and reuses the anchor", () => {
  // Regression: every scanned button's innerText was read after each page mutation; innerText forces a
  // layout, and on a dirty page each read cost a full style recalc (85 per second, ~100ms each).
  let layoutReads = 0;
  const button = (text, extra = {}) => ({ textContent: text, get innerText() { layoutReads++; return text; }, isConnected: true, ...extra });
  const ordinary = ["设置", "新聊天", "搜索", "Codex 帮助"].map((text) => button(text));
  const anchor = button("插件");
  const documentRef = { querySelectorAll: () => [...ordinary, anchor] };
  const trim = (value) => value.trim();
  assert.equal(findNativeEntryAnchor(documentRef, trim), anchor);
  assert.equal(layoutReads, 0, "an exact label needs no layout");
  const cache = {}; let scans = 0;
  const counting = { querySelectorAll: (...args) => { scans++; return documentRef.querySelectorAll(...args); } };
  for (let i = 0; i < 5; i++) assert.equal(findNativeEntryAnchor(counting, trim, cache), anchor);
  assert.equal(scans, 1, "the anchor is scanned for once while it stays connected");
  anchor.isConnected = false;
  const replacement = button("Apps");
  assert.equal(findNativeEntryAnchor({ querySelectorAll: () => [...ordinary, replacement] }, trim, cache), replacement, "a replaced anchor is found again");
  assert.equal(findNativeEntryAnchor({ querySelectorAll: () => [button("Plugins for Apps")] }, trim), null);
  const hidden = { textContent: "插件 (hidden)", innerText: "插件", isConnected: true };
  assert.equal(findNativeEntryAnchor({ querySelectorAll: () => [hidden] }, trim), hidden, "a label followed by hidden text is confirmed by innerText, as before");
});

test("outer injection version tracks native tabs source so recent menu changes replace an old installation", () => {
  const source = buildInjectionScript("http://127.0.0.1:47831");
  const digest = createHash("sha256").update(buildNativeConversationTabsInjectionSource()).digest("hex").slice(0, 12);
  const providerDigest = createHash("sha256").update(buildNativeProviderNavigationSource()).digest("hex").slice(0, 12);
  const probeDigest = createHash("sha256").update(findNativeEntryAnchor.toString() + nativeLayoutTransition.toString()).digest("hex").slice(0, 8);
  assert.match(source, new RegExp(`const INJECTION_VERSION = "2026-09-27\\.chatgpt26\\.terminal-inline\\.tabs-${digest}\\.provider-${providerDigest}\\.probe-${probeDigest}\\.standalone-false"`));
  assert.match(source, /codex-control-console-open-checklist-task/);
  assert.doesNotMatch(source, /发送于 /);
});

test("standalone dashboard mode routes existing modules through the native binding and keeps terminal conversations embedded", () => {
  const source = buildInjectionScript("http://127.0.0.1:47831", { standaloneDashboardBinding: "codexControlConsoleOpenDashboard" });
  assert.match(source, /const STANDALONE_DASHBOARD_BINDING = "codexControlConsoleOpenDashboard"/);
  assert.match(source, /if \(module !== 'terminal' && STANDALONE_DASHBOARD_BINDING && typeof window\[STANDALONE_DASHBOARD_BINDING\] === 'function'\)/);
  assert.match(source, /installNativeTerminalProvider\(DASHBOARD_URL, readNativeSidebarModel, createNativeTerminalSidebar, createNativeTerminalActions/);
  assert.match(source, /window\[STANDALONE_DASHBOARD_BINDING\]\(JSON\.stringify/);
  assert.match(source, /standalone-true/);
  assert.doesNotThrow(() => new Function(source));
});

test("injection source includes a duplicate guard and dashboard origin", () => {
  const source = buildInjectionScript("http://127.0.0.1:47831");
  assert.match(source, new RegExp(CONTROL_ENTRY_ATTRIBUTE));
  assert.match(source, new RegExp(KANBAN_ENTRY_ATTRIBUTE));
  assert.match(source, new RegExp(SESSION_ENTRY_ATTRIBUTE));
  assert.match(source, new RegExp(PRIORITY_ENTRY_ATTRIBUTE));
  assert.match(source, /KANBAN_ENTRY_TEXT = '看板'/);
  assert.match(source, /placeNativeBoardBelowChecklist\(document\.querySelector\(KANBAN_ENTRY_SELECTOR\), document\.querySelector\('\[data-ccc-general-checklist-entry\]'\)\)/);
  assert.match(source, /SESSION_ENTRY_TEXT = '会话中心'/);
  assert.match(source, /PRIORITY_ENTRY_TEXT = '项目优先级'/);
  assert.doesNotMatch(source, /data-codex-control-console-version/);
  assert.match(source, /codex-control-console-show-module/);
  assert.match(source, /FRAME_ALLOW = 'clipboard-read; clipboard-write'/);
  assert.match(source, /FRAME_READY_TYPE = 'codex-control-console-ready'/);
  assert.match(source, /FRAME_RECOVERY_KEY = 'codex-control-console\.frame-recovery\.v1'/);
  assert.match(source, /cancelEmbeddedFrameRecovery\(\)/);
  assert.match(source, /function restoreWorkspace\(\) \{\s+cancelEmbeddedFrameRecovery\(\)/);
  assert.doesNotMatch(source, /local-network-access/);
  assert.match(source, /activeFrame\?\.setAttribute\('allow', FRAME_ALLOW\)/);
  assert.match(source, /frame\.setAttribute\('allow', FRAME_ALLOW\)/);
  assert.doesNotMatch(source, /frame\.addEventListener\('load', \(\) => \{\s+loading\.remove\(\);\s+frame\.setAttribute\('data-codex-control-console-frame-ready'/);
  assert.match(source, /event\.origin !== DASHBOARD_ORIGIN/);
  assert.match(source, /currentFrame\.dispatchEvent\(new Event\(FRAME_READY_TYPE\)\)/);
  assert.match(source, /sessionStorage\.setItem\(FRAME_RECOVERY_KEY/);
  assert.match(source, /data-codex-control-console-frame-recovery-request/);
  assert.match(source, /requestEmbeddedFramePreparation\(module, terminalTarget\)/);
  assert.doesNotMatch(source, /location\.reload\(\)/);
  assert.match(source, /if \(pendingFrameRecovery\)/);
  assert.match(source, /currentFrame\(\) !== openingFrame/);
  assert.match(source, /Boolean\(nativeAnchor\(\)\)/);
  assert.match(source, /openWorkspace\(recovery\.module, '正在恢复会话…', recovery\.module !== 'terminal'\)/);
  assert.match(source, /url\.searchParams\.set\('theme', nativeTheme\(\)\)/);
  assert.match(source, /url\.searchParams\.set\('embedded', 'native'\)/);
  assert.match(source, /prefers-color-scheme: dark/);
  assert.match(source, /luminance < 128/);
  assert.match(source, /type: 'navigate-to-route'/);
  assert.match(source, /path: '\/local\/' \+ encodeURIComponent\(localThreadId\)/);
  assert.match(source, /'native-route-id'/);
  assert.match(source, /__codexControlConsoleOpenNativeThread/);
  assert.match(source, /native-route-context/);
  assert.match(source, /style\.visibility !== 'hidden'/);
  assert.match(source, /belongsToCurrentWorkspace/);
  assert.match(source, /visiblyMounted/);
  assert.match(source, /__codexControlConsoleInjectionVersion/);
  assert.match(source, /__codexControlConsoleInjectionVersion === INJECTION_VERSION && window\.__codexControlConsoleObserver\) return/);
  assert.doesNotMatch(source, /__codexControlConsoleInjectionVersion === INJECTION_VERSION && document\.querySelector\(ENTRY_SELECTOR\)/);
  assert.doesNotMatch(source, /__codexControlConsoleInjectionVersion === INJECTION_VERSION && document\.querySelector\('\[data-codex-control-console-native-tabs\]'\)/);
  assert.match(source, /__codexControlConsoleObserver\?\.disconnect/);
  assert.match(source, /__codexControlConsoleMutationSubscribers/);
  assert.match(source, /subscriber\(records\)/);
  assert.match(source, /openWorkspace\('sessions', loadingLabel, !openingRemote\)/);
  assert.match(source, /__codexControlConsoleOpenRemoteConversation/);
  assert.match(source, /__codexControlConsoleConversationTabs/);
  assert.doesNotMatch(source, /window\.__codexControlConsoleConversationTabs\?\.destroy/);
  assert.match(source, /installNativeConversationTabs/);
  assert.match(source, /openLocal/);
  assert.match(source, /openLocal: \(tab\) => \{[\s\S]*const openNativeThread = window\.__codexControlConsoleOpenNativeThread/);
  assert.match(source, /void openNativeThread\(tab\.id\)\.catch/);
  assert.match(source, /openChatgpt/);
  assert.match(source, /openRemote/);
  assert.match(source, /openWindow/);
  assert.match(source, /electronBridge\?\.sendMessageFromView/);
  assert.match(source, /request\?\.type !== 'open-in-new-window'/);
  assert.match(source, /\^\\\/\(\?:local\|c\)\\\//);
  assert.match(source, /path: '\/c\/' \+ encodeURIComponent\(tab\.id\)/);
  assert.match(source, /data-codex-control-console-ordinary-chat-row/);
  assert.match(source, /codex-control-console-open-remote-conversation/);
  assert.match(source, /__codexControlConsoleCopyRemoteProject/);
  assert.match(source, /codex-control-console-copy-remote-project/);
  assert.match(source, /const normalized = \{ id, deviceId, title, cwd, deviceName \}/);
  assert.match(source, /正在打开会话…/);
  assert.match(source, /postMessage\(message, DASHBOARD_ORIGIN\)/);
  assert.match(source, /data-app-action-sidebar-thread-id/);
  assert.match(source, /setTimeout\(restoreWorkspace, 0\)/);
  assert.match(source, /__codexControlConsoleNativeThreadListener/);
  assert.match(source, /\['console', 'sessions', 'priority', 'projects', 'conversations', 'terminal'\]\.includes\(module\) \? module : 'board'/);
  assert.match(source, /__codexControlConsoleInjected/);
  assert.doesNotMatch(source, /__codexControlConsoleSetProjectOrder/);
  assert.doesNotMatch(source, /data-codex-control-console-project-rank/);
  assert.match(source, /http:\/\/127\.0\.0\.1:47831/);
  assert.doesNotMatch(source, /127\.0\.0\.1:9231/);
  assert.doesNotThrow(() => new Function(source));
});

test("loading and error pages never receive a floating fallback button rail", () => {
  const source=buildInjectionScript("http://127.0.0.1:47831");
  assert.doesNotMatch(source,/function createFallbackEntry|document\.body\.append\(rail\)/);
  assert.match(source,/if \(!anchor\) \{\s+fallback\?\.remove\(\);\s+return;/);
});

test("console rows can dismiss the native terminal view without an iframe workspace ever opening", () => {
  const source = buildInjectionScript("http://127.0.0.1:47831");
  const boot = source.slice(source.indexOf("function boot()"));
  const close = boot.indexOf("window.__codexControlConsoleClose = () => { cancelTerminalNavigation(); restoreWorkspace(); };");
  assert.ok(close > 0, "boot defines the close hook");
  assert.ok(close < boot.indexOf("window.__codexControlConsoleConversationTabs = installNativeConversationTabs("), "before any row can be clicked");
  const restore = source.slice(source.indexOf("function restoreWorkspace()"), source.indexOf("function restoreWorkspace()") + 200);
  assert.match(restore, /window\.__cccNativeTerminalView\?\.dispose\(\)/);
});

test("native navigation controls close the terminal view and drop its active tab", () => {
  const source = buildInjectionScript("http://127.0.0.1:47831");
  const handler = source.slice(source.indexOf("function handleNativeThreadSelection"), source.indexOf("function boot()"));
  assert.match(handler, /if \(!nativeNavigationControl\(event\.target\)\) return;/);
  assert.match(handler, /active\?\.\(\)\?\.kind === 'terminal'\) tabs\.showConsole\?\.\(undefined, true\)/);
});
