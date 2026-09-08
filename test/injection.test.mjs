import test from "node:test";
import assert from "node:assert/strict";
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
  assert.equal(injectionDecision({ hasEntry: false, hasAnchor: false }), "install-fallback-entry");
});

test("injection source includes a duplicate guard and dashboard origin", () => {
  const source = buildInjectionScript("http://127.0.0.1:47831");
  assert.match(source, new RegExp(CONTROL_ENTRY_ATTRIBUTE));
  assert.match(source, new RegExp(KANBAN_ENTRY_ATTRIBUTE));
  assert.match(source, new RegExp(SESSION_ENTRY_ATTRIBUTE));
  assert.match(source, new RegExp(PRIORITY_ENTRY_ATTRIBUTE));
  assert.match(source, /KANBAN_ENTRY_TEXT = '看板'/);
  assert.match(source, /SESSION_ENTRY_TEXT = '会话中心'/);
  assert.match(source, /PRIORITY_ENTRY_TEXT = '项目优先级'/);
  assert.doesNotMatch(source, /data-codex-control-console-version/);
  assert.match(source, /codex-control-console-show-module/);
  assert.match(source, /FRAME_ALLOW = 'clipboard-read; clipboard-write'/);
  assert.doesNotMatch(source, /local-network-access/);
  assert.match(source, /activeFrame\?\.setAttribute\('allow', FRAME_ALLOW\)/);
  assert.match(source, /frame\.setAttribute\('allow', FRAME_ALLOW\)/);
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
  assert.match(source, /__codexControlConsoleObserver\?\.disconnect/);
  assert.match(source, /openWorkspace\('sessions', loadingLabel, !openingRemote\)/);
  assert.match(source, /__codexControlConsoleOpenRemoteConversation/);
  assert.match(source, /__codexControlConsoleConversationTabs/);
  assert.doesNotMatch(source, /window\.__codexControlConsoleConversationTabs\?\.destroy/);
  assert.match(source, /installNativeConversationTabs/);
  assert.match(source, /openLocal/);
  assert.match(source, /openChatgpt/);
  assert.match(source, /openRemote/);
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
  assert.match(source, /\['console', 'sessions', 'priority'\]\.includes\(module\) \? module : 'board'/);
  assert.match(source, /__codexControlConsoleInjected/);
  assert.doesNotMatch(source, /__codexControlConsoleSetProjectOrder/);
  assert.doesNotMatch(source, /data-codex-control-console-project-rank/);
  assert.match(source, /http:\/\/127\.0\.0\.1:47831/);
  assert.doesNotMatch(source, /127\.0\.0\.1:9231/);
  assert.doesNotThrow(() => new Function(source));
});
