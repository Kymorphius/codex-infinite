import test from "node:test";
import assert from "node:assert/strict";
import { conversationTabKey, ConversationTabState } from "../public/features/sessions/conversation-tabs.js";

const task = (id, deviceId = "remote", title = id) => ({ id, title, device: { id: deviceId, name: deviceId } });

test("conversation tab identity requires and preserves the owner-device tuple", () => {
  assert.equal(conversationTabKey(task("same", "remote-a")), "remote-a/same");
  assert.notEqual(conversationTabKey(task("same", "remote-a")), conversationTabKey(task("same", "remote-b")));
  assert.equal(conversationTabKey({ id: "missing-owner" }), "");
});

test("opening a conversation activates one deduplicated tab with refreshed metadata", () => {
  const state = new ConversationTabState();
  state.open(task("one", "remote", "First title"));
  state.open(task("one", "remote", "Updated title"));
  state.open(task("one", "other", "Other owner"));
  assert.equal(state.tabs.length, 2);
  assert.equal(state.tabs[0].task.title, "Updated title");
  assert.equal(state.activeTask().title, "Other owner");
});

test("closing the active tab selects right, then left, then Console without destructive state", () => {
  const state = new ConversationTabState();
  const one = task("one");
  const two = task("two");
  const three = task("three");
  state.open(one);
  state.open(two);
  state.open(three);
  state.activate(conversationTabKey(two));

  assert.equal(state.close(conversationTabKey(two)), three);
  assert.equal(state.close(conversationTabKey(three)), one);
  assert.equal(state.close(conversationTabKey(one)), null);
  assert.equal(state.activeKey, "home");
  assert.deepEqual(state.tabs, []);
});

test("closing a background tab keeps the active conversation selected", () => {
  const state = new ConversationTabState();
  const one = task("one");
  const two = task("two");
  state.open(one);
  state.open(two);
  assert.equal(state.close(conversationTabKey(one)), two);
  assert.equal(state.activeTask(), two);
});
