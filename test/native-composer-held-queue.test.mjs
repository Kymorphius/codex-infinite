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
  assert.match(pause, /origin: 'paused-queue'/);
  const resume = source.slice(source.indexOf("async function resumeItem"), source.indexOf("async function reorderServer"));
  assert.ok(resume.indexOf("thread/queue/add") < resume.indexOf("writeHeld"));
});

test("native held queue saves the current text draft before clearing it", () => {
  const source = buildNativeComposerHeldQueueInjectionScript();
  const read = source.slice(source.indexOf("function draftText"), source.indexOf("function updateDraftButton"));
  const clear = source.slice(source.indexOf("function clearDraftText"), source.indexOf("function saveDraftTodo"));
  const save = source.slice(source.indexOf("function saveDraftTodo"), source.indexOf("function syncNative"));
  assert.match(source, /存为待办/);
  assert.match(source, /data-ccc-save-draft-todo/);
  assert.ok(save.indexOf("writeHeld") < save.indexOf("clearDraftText"));
  assert.match(save, /\[{ type: 'text', text }\]/);
  assert.match(save, /origin: 'draft'/);
  assert.doesNotMatch(save, /thread\/queue\/add/);
  assert.match(source, /items\.length > MAX_HELD/);
  assert.doesNotMatch(clear, /selectAll/);
  assert.match(clear, /range\.selectNodeContents\(editor\)/);
  assert.match(clear, /editor\.contains\(selection\.anchorNode\)/);
  assert.match(clear, /editor\.contains\(selection\.focusNode\)/);
  assert.ok(clear.indexOf("selectionIsInsideEditor") < clear.indexOf("execCommand('delete'"));
  assert.match(read, /data-composer-markdown/);
  assert.ok(read.indexOf("data-composer-markdown") < read.indexOf("innerText"));
});

test("save-as-todo isolates pointer activation from native composer submission", () => {
  const source = buildNativeComposerHeldQueueInjectionScript();
  const control = source.slice(source.indexOf("function draftTodoButton"), source.indexOf("function setBusy"));
  for (const event of ["pointerdown", "mousedown", "click"]) assert.match(control, new RegExp(`addEventListener\\('${event}'`));
  assert.match(control, /event\.preventDefault\(\)/);
  assert.match(control, /event\.stopImmediatePropagation\(\)/);
  assert.match(control, /void saveDraftTodo\(\)/);
});

test("native held queue exposes composer management and stale queue recovery", () => {
  const source = buildNativeComposerHeldQueueInjectionScript();
  assert.match(source, /待发管理/);
  assert.match(source, /暂停/);
  assert.match(source, /恢复/);
  assert.match(source, /同步原生队列/);
  assert.match(source, /App-server queued follow-up no longer exists/);
  assert.ok(source.includes('[role="alert"],[data-sonner-toast]'));
  assert.match(source, /containsStaleQueueAlert/);
  assert.ok(source.includes("replace(/\\s+/g, ' ')"));
  assert.match(source, /DRAFT_KEY/);
  assert.match(source, /location\.reload\(\)/);
  assert.match(source, /staleThreads\.add\(id\)/);
});

test("save-as-todo survives composer remounts independently of legacy queue reinjection", () => {
  const source = buildNativeComposerHeldQueueInjectionScript();
  const lifecycleStart = source.indexOf("function installSaveDraftTodo");
  const lifecycle = source.slice(lifecycleStart, source.indexOf("window.__codexControlConsoleHeldQueueTimer", lifecycleStart));
  assert.match(source, /__codexControlConsoleSaveDraftTodoVersion/);
  assert.match(lifecycle, /__codexControlConsoleSaveDraftTodoObserver = new MutationObserver/);
  assert.match(lifecycle, /scheduleSaveDraftTodo/);
  assert.match(lifecycle, /__codexControlConsoleSaveDraftTodoInputCleanup/);
  assert.match(lifecycle, /updateIndependentDraftButton/);
  assert.match(lifecycle, /data-ccc-save-draft-todo/);
  assert.match(lifecycle, /draftTodoButton\(\)/);
  assert.match(lifecycle, /manager\?\.parentElement === host \? manager : null/);
});

test("held queue records retain a bounded source marker for truthful labels", () => {
  const source = buildNativeComposerHeldQueueInjectionScript();
  assert.match(source, /HELD_ORIGINS = new Set\(\['draft', 'paused-queue'\]\)/);
  assert.match(source, /待办·直存/);
  assert.match(source, /待办·暂停/);
});
