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
