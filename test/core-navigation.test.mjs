import test from "node:test";
import assert from "node:assert/strict";
import { createNavigation } from "../public/core/navigation.js";

function navigationFor(windowRef, messages) {
  return createNavigation({
    state: { module: "board" }, modules: { board: { title: "看板", caption: "" } },
    $() {}, showToast(message) { messages.push(message); }, onActivate() {}, async onRefresh() {},
    documentRef: {}, windowRef
  });
}

test("native task opening posts the stable minimal task contract to the parent frame", () => {
  const posts = [];
  const parent = { postMessage(message, target) { posts.push({ message, target }); } };
  const windowRef = { parent };
  const notices = [];
  navigationFor(windowRef, notices).requestOpen({ id: "task-1", title: "One", device: { id: "local" }, secret: "hidden" });
  assert.deepEqual(posts, [{ message: {
    type: "codex-control-console-open-task",
    task: { id: "task-1", title: "One", device: { id: "local" } }
  }, target: "*" }]);
  assert.deepEqual(notices, ["正在请求 Codex 打开任务…"]);
});

test("native task opening fails closed outside the embedded Codex frame", () => {
  const notices = [];
  const windowRef = {};
  windowRef.parent = windowRef;
  navigationFor(windowRef, notices).requestOpen({ id: "task-1", title: "One" });
  assert.deepEqual(notices, ["请在 Codex 控制台中打开任务。"]);
});

test("parent remote-conversation requests switch modules and preserve only the reference", () => {
  const handlers = {};
  const parent = {};
  const windowRef = { parent, addEventListener(type, handler) { handlers[type] = handler; } };
  const documentRef = { addEventListener() {}, querySelectorAll() { return []; }, title: "" };
  const state = { module: "board" };
  const opened = [];
  const navigation = createNavigation({
    state,
    modules: { board: { title: "看板", caption: "" }, sessions: { title: "会话", caption: "" } },
    $() { return { textContent: "" }; },
    showToast() {}, onActivate() {}, async onRefresh() {},
    onOpenRemoteConversation(reference) { opened.push(reference); },
    documentRef, windowRef
  });
  navigation.bind();
  handlers.message({ source: parent, data: { type: "codex-control-console-open-remote-conversation", reference: { id: "thread", deviceId: "remote" }, ignored: "secret" } });
  assert.equal(state.module, "sessions");
  assert.deepEqual(opened, [{ id: "thread", deviceId: "remote" }]);
  handlers.message({ source: {}, data: { type: "codex-control-console-open-remote-conversation", reference: { id: "wrong", deviceId: "remote" } } });
  assert.equal(opened.length, 1);
});

test("parent remote-project copy requests switch to sessions and preserve the exact source reference", () => {
  const handlers = {};
  const parent = {};
  const windowRef = { parent, addEventListener(type, handler) { handlers[type] = handler; } };
  const documentRef = { addEventListener() {}, querySelectorAll() { return []; }, title: "" };
  const state = { module: "board" };
  const copies = [];
  const navigation = createNavigation({
    state, modules: { board: { title: "看板", caption: "" }, sessions: { title: "会话", caption: "" } },
    $() { return { textContent: "" }; }, showToast() {}, onActivate() {}, async onRefresh() {},
    onCopyRemoteProject(reference) { copies.push(reference); }, documentRef, windowRef
  });
  navigation.bind();
  const reference = { deviceId: "windows-pc", sourceDirectory: "D:\\真仙幸存者", projectName: "真仙幸存者" };
  handlers.message({ source: parent, data: { type: "codex-control-console-copy-remote-project", reference } });
  assert.equal(state.module, "sessions");
  assert.deepEqual(copies, [reference]);
});

function tab(module) {
  const attributes = new Map();
  return {
    dataset: { moduleTarget: module }, tabIndex: null, focused: false,
    classList: { toggle() {} },
    setAttribute(name, value) { attributes.set(name, value); },
    getAttribute(name) { return attributes.get(name); },
    closest() { return this; },
    focus() { this.focused = true; }
  };
}

test("module tabs synchronize selection and support wrapped keyboard navigation", () => {
  const handlers = {};
  const board = tab("board");
  const sessions = tab("sessions");
  const nodes = { title: { textContent: "" }, caption: { textContent: "" } };
  const documentRef = {
    title: "",
    addEventListener(type, handler) { handlers[type] = handler; },
    querySelectorAll(selector) { return selector.includes('role="tab"') || selector === "[data-module-target]" ? [board, sessions] : []; }
  };
  const windowRef = { parent: {}, addEventListener() {} };
  const state = { module: "board" };
  const navigation = createNavigation({
    state,
    modules: { board: { title: "看板", caption: "任务" }, sessions: { title: "会话中心", caption: "会话" } },
    $(selector) { return selector.includes("title") ? nodes.title : nodes.caption; },
    showToast() {}, onActivate() {}, async onRefresh() {}, documentRef, windowRef
  });
  navigation.bind();
  navigation.updateChrome();
  assert.equal(board.getAttribute("aria-selected"), "true");
  assert.equal(sessions.getAttribute("aria-selected"), "false");
  assert.equal(board.tabIndex, 0);
  assert.equal(sessions.tabIndex, -1);

  let prevented = false;
  handlers.keydown({ target: board, key: "ArrowLeft", preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(state.module, "sessions");
  assert.equal(sessions.focused, true);
  assert.equal(sessions.getAttribute("aria-selected"), "true");
  assert.equal(nodes.title.textContent, "会话中心");
});
