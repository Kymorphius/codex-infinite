import test from "node:test";
import assert from "node:assert/strict";
import { buildNativeComposerHeldQueueInjectionScript } from "../src/native-composer-held-queue.mjs";
import { readHeldEditableText, replaceHeldEditableText } from "../src/held-queue-edit.mjs";
import { formatHeldInitialTime, orderHeldForView } from "../src/held-queue-presentation.mjs";
import { renderNativeClaimTaskButton } from "../src/native-claim-task-control.mjs";
import { updateHeldQueueShell } from "../src/native-assigned-checklist-tasks.mjs";

test("native held queue uses fixed app-server queue contracts and bounded local storage", () => {
  const source = buildNativeComposerHeldQueueInjectionScript();
  for (const method of ["thread/queue/list", "thread/queue/delete", "thread/queue/add", "thread/queue/reorder"]) assert.match(source, new RegExp(method.replaceAll("/", "\\/")));
  assert.match(source, /MAX_HELD = 100/);
  assert.match(source, /native-held-queue\.v1/);
  assert.match(source, /allowed = new Set/);
  assert.match(source, /hostId: 'local'/);
  assert.match(source, /data-above-composer-conversation-id/);
  assert.match(source, /data-app-action-sidebar-thread-selected/);
  assert.match(source, /codex-control-console-held-todos-changed/);
  assert.match(source, /领任务/);
  assert.match(source, /openClaimableForCurrentThread/);
  assert.match(source, /__codexControlConsoleSetClaimableTaskCount/);
  assert.match(source, /__codexControlConsoleSetAssignedChecklistTasks/);
  assert.match(source, /任务·已领取·暂停/);
  assert.match(source, /resumeAssignedTask/);
  assert.match(source, /completeAssignedTask/);
  assert.match(source, /恢复发送/);
  assert.match(source, /查看综合清单/);
  assert.match(source, /领任务 ' \+ count/);
  assert.match(source, /新建聊天后即可领取/);
  assert.match(source, /if \(!id\) \{.*claimTasks\.ensure/);
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
  const save = source.slice(source.indexOf("function saveDraftTodo"), source.indexOf("const draftTodoButton"));
  assert.match(source, /存待办/);
  assert.match(source, /order:1/);
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
  const control = source;
  for (const event of ["pointerdown", "mousedown", "click"]) assert.match(control, new RegExp(`addEventListener\\('${event}'`));
  assert.match(control, /event\.preventDefault\(\)/);
  assert.match(control, /event\.stopImmediatePropagation\(\)/);
  assert.match(control, /void saveDraftTodo\(\)/);
});

test("native held queue exposes composer management and stale queue recovery", () => {
  const source = buildNativeComposerHeldQueueInjectionScript();
  assert.match(source, /待办/);
  assert.match(source, /const text = '待办 '/);
  assert.match(source, /button\('待办', \(\) =>/);
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
  assert.match(source, /__codexControlConsoleSaveDraftTodoInstalledVersion/);
  assert.match(source, /LEGACY_SAVE = '2026-09-18\.1'/);
  assert.match(source, /__codexControlConsoleSaveDraftTodoVersion = LEGACY_SAVE/);
  assert.match(lifecycle, /__codexControlConsoleSaveDraftTodoObserver = new MutationObserver/);
  assert.match(lifecycle, /scheduleSaveDraftTodo/);
  assert.match(lifecycle, /__codexControlConsoleSaveDraftTodoInputCleanup/);
  assert.match(lifecycle, /removeDraftInputListener/);
  assert.match(lifecycle, /!document\.querySelector\('\[data-ccc-save-draft-todo\]'\) \|\| !document\.querySelector\('\[data-ccc-claim-task\]'\)/);
  const saveObserver = lifecycle.slice(lifecycle.indexOf('__codexControlConsoleSaveDraftTodoObserver ='), lifecycle.indexOf('__codexControlConsoleSaveDraftTodoObserver.observe') + 180);
  assert.doesNotMatch(saveObserver, /attributeFilter: \['aria-current'\]/);
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

test("held input editing changes one text part without dropping structured siblings", () => {
  const attachment = { type: "local_image", path: "/tmp/example.png" };
  const input = [{ type: "text", text: "before", text_elements: [{ start: 0, end: 6 }] }, attachment];
  assert.equal(readHeldEditableText(input), "before");
  const updated = replaceHeldEditableText(input, "  after  ");
  assert.deepEqual(updated, [{ type: "text", text: "after", text_elements: [] }, attachment]);
  assert.deepEqual(input[0].text_elements, [{ start: 0, end: 6 }]);
  assert.equal(replaceHeldEditableText(input, "   "), null);
  assert.equal(readHeldEditableText([{ type: "text", text: "a" }, { type: "text", text: "b" }]), null);
});

test("held todo time remains an explicit original timestamp hint", () => {
  const heldAt = new Date(2026, 8, 18, 16, 5, 7).getTime();
  assert.equal(formatHeldInitialTime(heldAt), "最初加入待办：2026-09-18 16:05:07");
  assert.equal(formatHeldInitialTime(undefined), "");
  const source = buildNativeComposerHeldQueueInjectionScript();
  assert.match(source, /badge\.title = timeHint/);
  assert.match(source, /title = timeHint \?/);
  assert.match(source, /editor\.title = timeHint/);
  assert.match(source, /\], item\.heldAt\)\)/);
});

test("manual and time views preserve distinct held ordering contracts", () => {
  const stored = [{ id: "later", heldAt: 20 }, { id: "earlier", heldAt: 10 }];
  assert.equal(orderHeldForView(stored, "manual"), stored);
  assert.deepEqual(orderHeldForView(stored, "time").map((item) => item.id), ["earlier", "later"]);
  assert.deepEqual(stored.map((item) => item.id), ["later", "earlier"]);
  const source = buildNativeComposerHeldQueueInjectionScript();
  assert.match(source, /手动视图/);
  assert.match(source, /时间视图/);
  assert.match(source, /VIEW_KEY/);
  assert.match(source, /heldView = readHeldView\(id\)/);
  assert.match(source, /heldView === 'time'/);
});

test("every pending row exposes edit and queued editing pauses before opening", () => {
  const source = buildNativeComposerHeldQueueInjectionScript();
  const pause = source.slice(source.indexOf("async function pauseItem"), source.indexOf("async function resumeItem"));
  const rows = source.slice(source.indexOf("serverItems.forEach"), source.indexOf("if (!serverItems.length"));
  assert.match(pause, /editAfterPause/);
  assert.ok(pause.indexOf("thread/queue/delete") < pause.indexOf("editing ="));
  assert.match(rows, /button\('编辑', \(\) => pauseItem\(id, item, true\)/);
  assert.match(rows, /button\('编辑', \(\) => startHeldEdit\(item\)/);
  assert.match(source, /button\('保存', \(\) => saveHeldEdit/);
  assert.match(source, /button\('取消', cancelHeldEdit/);
  assert.match(source, /editor\.dataset\.cccHeldEditor/);
});

test("new held manager remains authoritative while a legacy hot runtime is active", () => {
  const source = buildNativeComposerHeldQueueInjectionScript();
  assert.match(source, /__codexControlConsoleHeldQueueInstalledVersion/);
  assert.match(source, /LEGACY = '2026-09-18\.3'/);
  assert.match(source, /__codexControlConsoleHeldQueueVersion = LEGACY/);
  assert.match(source, /__codexControlConsoleSaveDraftTodoInstalledVersion === SAVE_DRAFT_VERSION/);
  assert.match(source, /__codexControlConsoleHeldQueueObserver && window\.__codexControlConsoleSaveDraftTodoObserver/);
  assert.match(source, /!document\.querySelector\('\[data-ccc-held-queue-button\]'\) \|\| !document\.querySelector\('\[data-ccc-held-queue-panel\]'\)/);
  assert.match(source, /if \(open && !busy && !editing\) void refresh\(\)/);
});

test("held manager avoids observer repaint loops and unchanged queue refreshes", () => {
  const source = buildNativeComposerHeldQueueInjectionScript();
  const refresh = source.slice(source.indexOf("async function refresh"), source.indexOf("async function pauseItem"));
  const install = source.slice(source.indexOf("function install()"), source.indexOf("function installSaveDraftTodo"));
  const observer = source.slice(source.indexOf("__codexControlConsoleHeldQueueObserver ="), source.indexOf("__codexControlConsoleHeldQueueObserver.observe"));
  assert.match(refresh, /queueIdentity\(serverItems\) !== queueIdentity\(next\)/);
  assert.match(refresh, /if \(changed\) render\(\)/);
  assert.doesNotMatch(refresh, /\n    render\(\);/);
  assert.match(observer, /id !== activeThreadId/);
  assert.match(observer, /data-ccc-held-queue-button/);
  assert.match(observer, /data-ccc-held-queue-panel/);
  assert.doesNotMatch(observer, /\n    schedule\(\);/);
  assert.match(install, /const panelCreated = !panel/);
  assert.match(install, /if \(threadChanged \|\| panelCreated\) render\(\); else updateShell\(id, toolbar, panel\)/);
  assert.doesNotMatch(install, /restoreDraft\(\); render\(\)/);
  assert.match(source, /JSON\.stringify\(next\) !== JSON\.stringify\(assignedTasks\)/);
});

test("held shell and claim controls skip identical DOM writes", () => {
  let toolbarText = "待办 3", toolbarWrites = 0, warning = "false", warningWrites = 0, hidden = true, hiddenWrites = 0;
  const toolbar = { dataset: {} };
  Object.defineProperty(toolbar, "textContent", { get: () => toolbarText, set: (value) => { toolbarText = value; toolbarWrites += 1; } });
  Object.defineProperty(toolbar.dataset, "warning", { get: () => warning, set: (value) => { warning = value; warningWrites += 1; } });
  const panel = {};
  Object.defineProperty(panel, "hidden", { get: () => hidden, set: (value) => { hidden = value; hiddenWrites += 1; } });
  updateHeldQueueShell(toolbar, panel, [{}], [{}], [{}], "", false);
  assert.deepEqual([toolbarWrites, warningWrites, hiddenWrites], [0, 0, 0]);

  let buttonText = "领任务 7", buttonTitle = "从综合任务清单领取 7 项未指派任务到当前会话", buttonWrites = 0;
  const button = {};
  Object.defineProperty(button, "textContent", { get: () => buttonText, set: (value) => { buttonText = value; buttonWrites += 1; } });
  Object.defineProperty(button, "title", { get: () => buttonTitle, set: (value) => { buttonTitle = value; buttonWrites += 1; } });
  renderNativeClaimTaskButton(button, 7);
  assert.equal(buttonWrites, 0);
  renderNativeClaimTaskButton(button, 8);
  assert.equal(buttonWrites, 2);
});
