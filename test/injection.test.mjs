import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildNativeConversationTabsInjectionSource } from "../src/native-conversation-tabs.mjs";
import { buildNativeProviderNavigationSource } from "../src/native-terminal-navigation.mjs";
import { findNativeEntryAnchor, nativeEntryMutationNeedsInstall } from "../src/native-entry-probe.mjs";
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

test("outer injection version tracks native tabs source so recent menu changes replace an old installation", () => {
  const source = buildInjectionScript("http://127.0.0.1:47831");
  const digest = createHash("sha256").update(buildNativeConversationTabsInjectionSource()).digest("hex").slice(0, 12);
  const providerDigest = createHash("sha256").update(buildNativeProviderNavigationSource()).digest("hex").slice(0, 12);
  assert.match(source, new RegExp(`const INJECTION_VERSION = "2026-09-26\\.managed-terminal\\.tabs-${digest}\\.provider-${providerDigest}"`));
  assert.match(source, /codex-control-console-open-checklist-task/);
  assert.doesNotMatch(source, /发送于 /);
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
