import test from "node:test";
import assert from "node:assert/strict";
import { createTerminalComposer, shouldSubmitTerminalDraft } from "../public/features/terminal/presentation.js";

function harness() {
  const calls = [];
  const views = new Map();
  let changes = 0;
  for (const id of ["claude", "shell"]) {
    const state = { canInput: true, sending: false };
    views.set(id, {
      state,
      snapshot: () => state,
      pasteText(text, options) {
        return new Promise((resolve, reject) => calls.push({ id, text, options, resolve, reject }));
      }
    });
  }
  const composer = createTerminalComposer({ getView: (id) => views.get(id), onChange: () => { changes += 1; } });
  composer.select("claude");
  return { composer, calls, views, changes: () => changes };
}

test("composer Enter submits while newlines, shortcuts, and IME confirmation remain editing", () => {
  assert.equal(shouldSubmitTerminalDraft({ key: "Enter" }), true);
  for (const property of ["shiftKey", "ctrlKey", "altKey", "metaKey", "isComposing"]) {
    assert.equal(shouldSubmitTerminalDraft({ key: "Enter", [property]: true }), false, property);
  }
  assert.equal(shouldSubmitTerminalDraft({ key: "Enter", keyCode: 229 }), false);
  assert.equal(shouldSubmitTerminalDraft({ key: "Enter" }, true), false);
  assert.equal(shouldSubmitTerminalDraft({ key: "a" }), false);
});

test("each terminal retains its own unsent draft when switching away and back", () => {
  const { composer } = harness();
  composer.setDraft("给 Claude 的中文消息\n第二行");
  composer.select("shell");
  assert.equal(composer.draft(), "");
  composer.setDraft("pwd");
  composer.select("claude");
  assert.equal(composer.draft(), "给 Claude 的中文消息\n第二行");
  composer.select("shell");
  assert.equal(composer.draft(), "pwd");
  composer.forget("shell");
  assert.equal(composer.draft(), "");
});

test("composer forwards exact text and submission intent to the selected native terminal", async () => {
  const { composer, calls } = harness();
  composer.select("shell");
  composer.setDraft("printf '你好\\n'");
  const sending = composer.send();
  assert.equal(calls.length, 1);
  assert.deepEqual({ id: calls[0].id, text: calls[0].text, options: calls[0].options }, { id: "shell", text: "printf '你好\\n'", options: { submit: true } });
  assert.deepEqual(composer.snapshot(), { draft: "printf '你好\\n'", canInput: true, canSend: false, sending: true });
  calls[0].resolve({ ok: true });
  assert.deepEqual(await sending, { ok: true });
  assert.equal(composer.draft(), "");
  assert.equal(composer.snapshot().canSend, true);
  composer.setDraft("未提交的多行\n文本");
  const pasting = composer.send({ submit: false });
  assert.deepEqual(calls[1].options, { submit: false });
  calls[1].resolve({ ok: true });
  await pasting;
  assert.equal(composer.draft(), "");
});

test("disconnection, active sends, and whitespace do not write to the terminal", async () => {
  const { composer, calls, views } = harness();
  composer.setDraft("保留此草稿");
  views.get("claude").state.canInput = false;
  assert.equal((await composer.send()).ok, false);
  assert.equal(composer.draft(), "保留此草稿");
  views.get("claude").state.canInput = true;
  views.get("claude").state.sending = true;
  assert.equal((await composer.send()).ok, false);
  views.get("claude").state.sending = false;
  composer.setDraft("  \n\t");
  assert.equal((await composer.send()).ok, false);
  assert.equal(calls.length, 0);
});

test("in-flight send blocks duplicate sends without blocking draft edits or terminal interrupts", async () => {
  const { composer, calls } = harness();
  composer.setDraft("first");
  const sending = composer.send();
  assert.equal((await composer.send()).ok, false);
  assert.equal(calls.length, 1);
  assert.equal(composer.snapshot().canInput, true);
  composer.setDraft("second");
  calls[0].resolve({ ok: true });
  await sending;
  assert.equal(composer.draft(), "second");
});

test("a completed send never clears the active draft in another session", async () => {
  const { composer, calls } = harness();
  composer.setDraft("Claude 草稿");
  const sending = composer.send();
  composer.select("shell");
  composer.setDraft("pwd");
  calls[0].resolve({ ok: true });
  await sending;
  assert.equal(composer.draft(), "pwd");
  composer.select("claude");
  assert.equal(composer.draft(), "");
});

test("editing back to identical text during a send retains the new draft revision", async () => {
  const { composer, calls } = harness();
  composer.setDraft("repeat intentionally");
  const sending = composer.send();
  composer.setDraft("changed");
  composer.setDraft("repeat intentionally");
  calls[0].resolve({ ok: true });
  await sending;
  assert.equal(composer.draft(), "repeat intentionally");
});

test("rejected or throwing transport preserves drafts and the native error message", async () => {
  const { composer, calls } = harness();
  composer.setDraft("不要丢失");
  const sending = composer.send();
  calls[0].resolve({ ok: false, message: "可能已粘贴，请先查看终端。" });
  assert.deepEqual(await sending, { ok: false, message: "可能已粘贴，请先查看终端。" });
  assert.equal(composer.draft(), "不要丢失");
  const retry = composer.send();
  calls[1].reject(new Error("socket closed"));
  assert.match((await retry).message, /草稿已保留.*查看终端/u);
  assert.equal(composer.draft(), "不要丢失");
  assert.equal(composer.snapshot().sending, false);
});

test("closed sessions discard their own drafts and disposal discards all drafts", () => {
  const { composer } = harness();
  composer.setDraft("claude secret");
  composer.select("shell");
  composer.setDraft("shell secret");
  composer.forget("claude");
  composer.select("claude");
  assert.equal(composer.draft(), "");
  composer.select("shell");
  assert.equal(composer.draft(), "shell secret");
  composer.clear();
  assert.equal(composer.draft(), "");
});
