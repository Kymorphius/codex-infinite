import test from "node:test";
import assert from "node:assert/strict";
import { buildNativeConversationTabsInjectionSource } from "../src/native-conversation-tabs.mjs";
import { buildNativeTurnAnnotationsScript } from "../src/native-turn-annotations.mjs";
import { buildNativeNewProjectsInjectionScript } from "../src/native-new-projects.mjs";
import { buildNativeAttentionConversationsInjectionScript } from "../src/native-attention-conversations.mjs";
import { nativeOwnerPollDelay } from "../src/native-owner-injector.mjs";
import { installNativeJevMutationRefresh } from "../src/native-jev-mutation-refresh.mjs";

test("native conversation tabs coalesce broad mutation layout work", () => {
  const source = buildNativeConversationTabsInjectionSource();
  assert.match(source, /function scheduleSync\(urgent = false\)/);
  assert.match(source, /const interval = urgent \? 0 : 320/);
  assert.match(source, /scheduleSync\(routeChanged\(records\)\)/);
  assert.doesNotMatch(source, /position\(\); scheduleSync\(\)/);
  assert.match(source, /function syncNativeTitleTakeover\(workspace, workspaceRect, force = false\)/);
  assert.match(source, /now - topControlsScannedAt < 1000/);
  assert.match(source, /position\(urgent\)/);
  assert.match(source, /filter\(\(\{ bounds \}\) => bounds\.width > 0 && bounds\.height > 0 && bounds\.top < 42\)\s*\.map\(\(record\) => \(\{ \.\.\.record, style: getComputedStyle\(record\.button\) \}\)\)/);
});

test("turn annotations skip repeated bridge snapshots and coalesce layout reads", () => {
  const source = buildNativeTurnAnnotationsScript();
  assert.match(source, /if \(next === presentationSuppressed\) return/);
  assert.match(source, /acceptedSignature/);
  assert.match(source, /schedule\(200\)/);
  assert.match(source, /function schedulePaint\(\)/);
  assert.match(source, /paintFrame = requestFrame/);
  assert.match(source, /outputCard\?\.isConnected/);
  assert.match(source, /const timer = setTimeout\(\(\) => schedule\(\), 1000\)/);
  assert.doesNotMatch(source, /setInterval\(refresh, 1000\)/);
});

test("native sidebar projections do not observe their own render mutations", () => {
  for (const source of [buildNativeNewProjectsInjectionScript(), buildNativeAttentionConversationsInjectionScript()]) {
    assert.match(source, /function isOwnMutation\(record\)/);
    assert.match(source, /new MutationObserver\(records => \{ if \(!records\.every\(isOwnMutation\)\) schedule\(\); \}\)/);
  }
  const newProjects = buildNativeNewProjectsInjectionScript();
  assert.match(newProjects, /function scheduleExpiry\(\)/);
  assert.doesNotMatch(newProjects, /setInterval\(schedule, 1000\)/);
});

test("Jev mutation refresh ignores its own render but detects native remounts", () => {
  let installs = 0;
  const subscribers = new Set();
  const own = { nodeType: 1, matches: selector => selector.includes("data-codex-control-console-native-jev"), closest: selector => selector.includes("data-codex-control-console-native-jev") ? own : null, querySelector: () => null };
  const native = { nodeType: 1, matches: selector => selector.includes("data-above-composer-conversation-id"), closest: () => null, querySelector: () => null };
  const ordinary = { nodeType: 1, matches: () => false, closest: () => null, querySelector: () => null };
  const hostWindow = { __codexControlConsoleMutationSubscribers: subscribers, requestAnimationFrame(callback) { callback(); return 1; }, cancelAnimationFrame() {} };
  const cleanup = installNativeJevMutationRefresh({ install: () => { installs += 1; }, findModelChangeNotices: () => [], hostWindow });
  const receive = [...subscribers][0];
  receive([{ type: "childList", target: own, addedNodes: [], removedNodes: [] }]);
  receive([{ type: "childList", target: ordinary, addedNodes: [ordinary], removedNodes: [] }]);
  assert.equal(installs, 0);
  receive([{ type: "childList", target: ordinary, addedNodes: [native], removedNodes: [] }]);
  assert.equal(installs, 1);
  cleanup();
});

test("primary native bridge retry delay backs off and remains capped", () => {
  assert.equal(nativeOwnerPollDelay(1200, 0, 30000), 1200);
  assert.equal(nativeOwnerPollDelay(1200, 1, 30000), 2400);
  assert.equal(nativeOwnerPollDelay(1200, 4, 30000), 19200);
  assert.equal(nativeOwnerPollDelay(1200, 8, 30000), 30000);
});
