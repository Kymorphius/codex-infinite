import test from "node:test";
import assert from "node:assert/strict";
import { buildNativeComposerHeldQueueInjectionScript } from "../src/native-composer-held-queue.mjs";

test("native held queue uses fixed app-server queue contracts and bounded local storage", () => {
  const source = buildNativeComposerHeldQueueInjectionScript();
  for (const method of ["thread/queue/list", "thread/queue/delete", "thread/queue/add", "thread/queue/reorder"]) assert.match(source, new RegExp(method.replaceAll("/", "\\/")));
  assert.match(source, /MAX_HELD = 100/);
  assert.match(source, /native-held-queue\.v1/);
  assert.match(source, /allowed = new Set/);
  assert.match(source, /hostId: 'local'/);
  assert.match(source, /data-above-composer-conversation-id/);
});

test("native held queue saves before delete and adds before removing held copy", () => {
  const source = buildNativeComposerHeldQueueInjectionScript();
  const pause = source.slice(source.indexOf("async function pauseItem"), source.indexOf("async function resumeItem"));
  assert.ok(pause.indexOf("writeHeld") < pause.indexOf("thread/queue/delete"));
  assert.match(pause, /writeHeld\(id, before\)/);
  const resume = source.slice(source.indexOf("async function resumeItem"), source.indexOf("async function reorderServer"));
  assert.ok(resume.indexOf("thread/queue/add") < resume.indexOf("writeHeld"));
});

test("native held queue exposes composer management and stale queue recovery", () => {
  const source = buildNativeComposerHeldQueueInjectionScript();
  assert.match(source, /待发管理/);
  assert.match(source, /暂停/);
  assert.match(source, /恢复/);
  assert.match(source, /同步原生队列/);
  assert.match(source, /App-server queued follow-up no longer exists/);
  assert.match(source, /DRAFT_KEY/);
  assert.match(source, /location\.reload\(\)/);
  assert.match(source, /stale = true/);
});
