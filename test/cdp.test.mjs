import test from "node:test";
import assert from "node:assert/strict";
import { chooseMainTarget } from "../src/cdp-client.mjs";

test("target selection chooses the Codex app page, not a webview", () => {
  const target = chooseMainTarget([
    { id: "webview", type: "webview", url: "https://chatgpt.com", webSocketDebuggerUrl: "ws://127.0.0.1:9231/devtools/page/webview" },
    { id: "overlay", type: "page", url: "app://-/index.html?initialRoute=%2Favatar-overlay", webSocketDebuggerUrl: "ws://127.0.0.1:9231/devtools/page/overlay" },
    { id: "page", type: "page", url: "app://-/index.html", webSocketDebuggerUrl: "ws://127.0.0.1:9231/devtools/page/page" }
  ]);
  assert.equal(target.id, "page");
});

test("target selection fails closed when only a remote page is present", () => {
  assert.throws(() => chooseMainTarget([
    { id: "remote", type: "page", url: "https://example.com", webSocketDebuggerUrl: "ws://127.0.0.1:9231/devtools/page/remote" }
  ]), /No Codex app page target/);
});
