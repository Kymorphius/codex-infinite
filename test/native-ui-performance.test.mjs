import test from "node:test";
import assert from "node:assert/strict";
import { buildNativeConversationTabsInjectionSource } from "../src/native-conversation-tabs.mjs";
import { buildNativeTurnAnnotationsScript } from "../src/native-turn-annotations.mjs";
import { nativeOwnerPollDelay } from "../src/native-owner-injector.mjs";

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
});

test("primary native bridge retry delay backs off and remains capped", () => {
  assert.equal(nativeOwnerPollDelay(1200, 0, 30000), 1200);
  assert.equal(nativeOwnerPollDelay(1200, 1, 30000), 2400);
  assert.equal(nativeOwnerPollDelay(1200, 4, 30000), 19200);
  assert.equal(nativeOwnerPollDelay(1200, 8, 30000), 30000);
});
