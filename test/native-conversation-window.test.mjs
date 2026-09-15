import test from "node:test";
import assert from "node:assert/strict";
import {
  createNativeConversationWindowButton,
  nativeConversationWindowRequest,
  openNativeConversationWindow
} from "../src/native-conversation-window.mjs";

const id = "01a0a5b3-8beb-78e3-9ee8-d7a0969d7c8c";

test("native conversation windows use exact validated owner routes", () => {
  assert.deepEqual(nativeConversationWindowRequest({ kind: "local", id: id.toUpperCase() }), {
    type: "open-in-new-window",
    path: `/local/${id}`
  });
  assert.deepEqual(nativeConversationWindowRequest({ kind: "chatgpt", id }), {
    type: "open-in-new-window",
    path: `/c/${id}`
  });
});

test("native conversation windows fail closed for remote or invalid tabs", () => {
  assert.equal(nativeConversationWindowRequest({ kind: "remote", id, deviceId: "windows" }), null);
  assert.equal(nativeConversationWindowRequest({ kind: "local", id: "not-a-thread" }), null);
  assert.equal(nativeConversationWindowRequest({ kind: "console" }), null);
  assert.equal(nativeConversationWindowRequest(null), null);
});

test("native conversation window action reports bridge success and failure", async () => {
  const attributes = new Map();
  const button = { title: "", setAttribute: (name, value) => attributes.set(name, value), removeAttribute: (name) => attributes.delete(name) };
  const state = { tabs: [{ kind: "local", id, title: "任务" }] };
  const keyFor = (tab) => `${tab.kind}:${tab.id}`;
  assert.equal(await openNativeConversationWindow({ state, keyFor, key: `local:${id}`, button, openWindow: async (_tab, request) => request.type === "open-in-new-window" }), true);
  assert.equal(attributes.has("data-window-opening"), false);
  assert.equal(attributes.has("data-window-opened"), true);
  assert.equal(await openNativeConversationWindow({ state, keyFor, key: `local:${id}`, button, openWindow: async () => false }), false);
  assert.equal(attributes.has("data-window-error"), true);
});

test("native conversation window button is omitted for unsupported tabs", () => {
  const documentRef = { createElement: () => ({ dataset: {}, setAttribute() {} }) };
  assert.equal(createNativeConversationWindowButton(documentRef, { kind: "remote", id, title: "远端" }, "remote:key"), null);
  const button = createNativeConversationWindowButton(documentRef, { kind: "local", id, title: "任务" }, `local:${id}`);
  assert.equal(button.dataset.windowKey, `local:${id}`);
  assert.equal(button.title, "在新窗口打开");
});
