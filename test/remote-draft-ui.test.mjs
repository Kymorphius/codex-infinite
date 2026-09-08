import test from "node:test";
import assert from "node:assert/strict";
import { comparableDraftText, createRemoteDraftSync, remoteDraftMerge } from "../public/features/sessions/draft-sync.js";

test("local draft deletion is preserved until it synchronizes to the owner", () => {
  assert.equal(remoteDraftMerge({ localText: "", syncedText: "owner draft", dirty: true, remoteText: "owner draft" }), "preserve-local");
  assert.equal(remoteDraftMerge({ localText: "", syncedText: "owner draft", dirty: true, remoteText: "" }), "confirm");
  assert.equal(remoteDraftMerge({ localText: "owner draft", syncedText: "owner draft", dirty: false, remoteText: "owner edit" }), "apply-remote");
});

test("Windows contenteditable blank-line expansion is not a draft conflict", () => {
  const localText = "标题\n\n- A\n- B";
  const remoteText = "标题\n\n\n\n\n- A\n\n- B";
  assert.equal(comparableDraftText(localText), comparableDraftText(remoteText));
  assert.equal(remoteDraftMerge({ localText, syncedText: localText, dirty: true, remoteText }), "confirm");
});

test("a confirmed remote refresh clears a stale draft synchronization error", async () => {
  const prompt = { value: "" };
  const task = { id: "thread", device: { id: "windows", name: "Windows Desktop" } };
  const statuses = [];
  const drafts = createRemoteDraftSync({
    prompt,
    getTask: () => task,
    isSending: () => false,
    status(message, tone) { statuses.push([message, tone]); },
    async fetchImpl() { return { ok: false, status: 405, async json() { return { message: "Method not allowed" }; } }; }
  });
  drafts.syncRemote(task, { text: "owner draft", revision: "a".repeat(64) });
  prompt.value = "";
  drafts.markLocalChange();
  drafts.cancelTimer();
  await drafts.flush();
  assert.deepEqual(statuses.at(-1), ["草稿未同步：Method not allowed", "error"]);
  drafts.syncRemote(task, null);
  assert.equal(drafts.dirty, false);
  assert.deepEqual(statuses.at(-1), ["", ""]);
});
