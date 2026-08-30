import test from "node:test";
import assert from "node:assert/strict";
import {
  buildInjectionScript,
  injectionDecision,
  CONTROL_ENTRY_ATTRIBUTE,
  KANBAN_ENTRY_ATTRIBUTE,
  SESSION_ENTRY_ATTRIBUTE,
  TITLEBAR_SESSION_ENTRY_ATTRIBUTE,
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
  assert.match(source, new RegExp(TITLEBAR_SESSION_ENTRY_ATTRIBUTE));
  assert.match(source, new RegExp(PRIORITY_ENTRY_ATTRIBUTE));
  assert.match(source, /KANBAN_ENTRY_TEXT = '看板'/);
  assert.match(source, /SESSION_ENTRY_TEXT = '会话中心'/);
  assert.match(source, /PRIORITY_ENTRY_TEXT = '项目优先级'/);
  assert.match(source, /codex-control-console-show-module/);
  assert.match(source, /type: 'navigate-to-route'/);
  assert.match(source, /path: '\/local\/' \+ encodeURIComponent\(localThreadId\)/);
  assert.match(source, /method: 'native-route-id'/);
  assert.match(source, /style\.visibility !== 'hidden'/);
  assert.match(source, /belongsToCurrentWorkspace/);
  assert.match(source, /visiblyMounted/);
  assert.match(source, /__codexControlConsoleInjectionVersion/);
  assert.match(source, /__codexControlConsoleObserver\?\.disconnect/);
  assert.match(source, /aria-label', '打开会话中心'/);
  assert.match(source, /openWorkspace\('sessions'\)/);
  assert.match(source, /\['console', 'sessions', 'priority'\]\.includes\(module\) \? module : 'board'/);
  assert.match(source, /__codexControlConsoleInjected/);
  assert.doesNotMatch(source, /__codexControlConsoleSetProjectOrder/);
  assert.doesNotMatch(source, /data-codex-control-console-project-rank/);
  assert.match(source, /http:\/\/127\.0\.0\.1:47831/);
  assert.doesNotMatch(source, /127\.0\.0\.1:9231/);
});
