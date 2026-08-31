import test from "node:test";
import assert from "node:assert/strict";
import {
  buildNativeContextInjectionScript,
  buildNativeContextSnapshotScript,
  normalizeNativeContextAction,
  normalizeNativeContextOverrides
} from "../src/native-context-injection.mjs";

test("native context snapshot accepts only UUIDs and bounded integer windows", () => {
  assert.deepEqual(normalizeNativeContextOverrides([
    { threadId: "01A015AC-363F-7472-961A-F31D174AD2C8", requestedContextWindow: 1_000_000 },
    { threadId: "not-a-thread", requestedContextWindow: 1_000_000 },
    { threadId: "019f6a9b-1a11-7777-8888-123456789abc", requestedContextWindow: 12 }
  ]), [{ threadId: "01a015ac-363f-7472-961a-f31d174ad2c8", contextWindow: 1_000_000 }]);
});

test("native context actions accept only bounded set/remove contracts", () => {
  assert.deepEqual(normalizeNativeContextAction({
    action: "set", threadId: "01A015AC-363F-7472-961A-F31D174AD2C8", contextWindow: 1_000_000
  }), { action: "set", threadId: "01a015ac-363f-7472-961a-f31d174ad2c8", contextWindow: 1_000_000 });
  assert.deepEqual(normalizeNativeContextAction({
    action: "remove", threadId: "01a015ac-363f-7472-961a-f31d174ad2c8", contextWindow: "ignored"
  }), { action: "remove", threadId: "01a015ac-363f-7472-961a-f31d174ad2c8" });
  assert.equal(normalizeNativeContextAction({ action: "set", threadId: "bad", contextWindow: 1_000_000 }), null);
  assert.equal(normalizeNativeContextAction({ action: "other", threadId: "01a015ac-363f-7472-961a-f31d174ad2c8" }), null);
});

test("native bridge resumes through the desktop app-server with thread-scoped config", () => {
  const source = buildNativeContextInjectionScript();
  assert.match(source, /method, params/);
  assert.match(source, /request\('thread\/resume'/);
  assert.match(source, /config\.model_context_window = contextWindow/);
  assert.match(source, /config\.model_auto_compact_token_limit = contextWindow/);
  assert.match(source, /data-app-action-sidebar-thread-id/);
  assert.match(source, /__codexControlConsoleOpenNativeThread/);
  assert.match(source, /data-codex-control-console-context-toggle/);
  assert.match(source, /button\.dataset\.renderState === renderState/);
  assert.match(source, /data-context-toggle-status/);
  assert.match(source, /百万上下文/);
  assert.match(source, /__codexControlConsoleDrainContextActions/);
  assert.match(source, /__codexControlConsolePersistContext/);
  assert.match(source, /__codexControlConsoleReadThreadStatuses/);
  assert.match(source, /request\('thread\/list'/);
  assert.match(source, /__codexControlConsoleInterruptThread/);
  assert.match(source, /request\('turn\/interrupt'/);
  assert.match(source, /__codexControlConsoleApplyThreadSettings/);
  assert.match(source, /request\('thread\/settings\/update'/);
  assert.match(source, /thread not found/);
  assert.match(source, /await resume\(params\.threadId\)/);
  assert.match(source, /results\.settings = await updateThreadSettings\(update\)/);
  assert.match(source, /update\.effort = settings\.reasoningEffort/);
  assert.match(source, /update\.serviceTier = settings\.serviceTier/);
  assert.match(source, /update\.permissions = settings\.permissionProfile/);
  assert.match(source, /'default', 'priority', 'ultrafast'/);
  assert.match(source, /':read-only', ':workspace', ':danger-full-access'/);
});

test("native snapshot script contains normalized data only", () => {
  const source = buildNativeContextSnapshotScript([
    { threadId: "01a015ac-363f-7472-961a-f31d174ad2c8", requestedContextWindow: 1_000_000 }
  ]);
  assert.match(source, /__codexControlConsoleSetContextOverrides/);
  assert.match(source, /"contextWindow":1000000/);
  assert.doesNotMatch(source, /requestedContextWindow/);
});
