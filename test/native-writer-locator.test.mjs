import test from "node:test";
import assert from "node:assert/strict";
import { NativeWriterLocator } from "../src/native-writer-locator.mjs";

const threadId = "01a04445-8d03-7243-a4d3-181180bb626d";
const config = {
  sourceCodexHome: "/Users/test/.codex",
  appPath: "/Applications/ChatGPT.app",
  profileDirectory: "/Users/test/Library/Application Support/Codex Control Console",
  cdpPort: 9231,
  cdpOrigin: "http://127.0.0.1:9231",
  primaryProfileDirectory: "/Users/test/Library/Application Support/Codex",
  primaryCdpPort: 9232,
  primaryCdpOrigin: "http://127.0.0.1:9232",
  primaryCdpEnabled: true
};

function executor({ lsof = "p200\n", ps = "" } = {}) {
  return async (file, args) => {
    if (file.endsWith("lsof")) {
      assert.equal(args.at(-1), `/Users/test/.codex/thread-writer-locks/${threadId}.lock`);
      return { stdout: lsof };
    }
    return { stdout: ps };
  };
}

test("writer locator maps a lock holder through its parent to the primary native CDP surface", async () => {
  const ps = [
    "200 150 /Applications/ChatGPT.app/Contents/Resources/codex app-server",
    "150 1 /Applications/ChatGPT.app/Contents/MacOS/ChatGPT --user-data-dir=/Users/test/Library/Application Support/Codex --remote-debugging-address=127.0.0.1 --remote-debugging-port=9232"
  ].join("\n");
  const locator = new NativeWriterLocator({ config, execFileImpl: executor({ ps }) });
  assert.deepEqual(await locator.locate(threadId), {
    state: "ready", surface: "primary-native", bridge: "writer-matched", cdpOrigin: "http://127.0.0.1:9232"
  });
});

test("writer locator refuses to route a primary-owned thread when its bridge is disabled", async () => {
  const ps = [
    "200 150 codex app-server",
    "150 1 /Applications/ChatGPT.app/Contents/MacOS/ChatGPT"
  ].join("\n");
  const locator = new NativeWriterLocator({ config: { ...config, primaryCdpEnabled: false }, execFileImpl: executor({ ps }) });
  assert.deepEqual(await locator.locate(threadId), { state: "bridge-unavailable", surface: "primary-native", bridge: "writer-matched" });
});

test("writer locator keeps a dedicated-profile-owned thread on its own native surface", async () => {
  const ps = [
    "200 150 codex app-server",
    "150 1 /Applications/ChatGPT.app/Contents/MacOS/ChatGPT --user-data-dir=/Users/test/Library/Application Support/Codex Control Console --remote-debugging-address=127.0.0.1 --remote-debugging-port=9231"
  ].join("\n");
  const locator = new NativeWriterLocator({ config, execFileImpl: executor({ ps }) });
  assert.deepEqual(await locator.locate(threadId), {
    state: "ready", surface: "dedicated-native", bridge: "writer-matched", cdpOrigin: "http://127.0.0.1:9231"
  });
});

test("writer locator uses the dedicated native surface only when the thread is dormant", async () => {
  const locator = new NativeWriterLocator({ config, execFileImpl: executor({ lsof: "" }) });
  assert.deepEqual(await locator.locate(threadId), {
    state: "ready", surface: "dedicated-native", bridge: "dormant-fallback", cdpOrigin: "http://127.0.0.1:9231"
  });
});

test("writer locator fails closed for an unknown writer parent", async () => {
  const locator = new NativeWriterLocator({ config, execFileImpl: executor({ ps: "200 1 /usr/local/bin/other-server" }) });
  assert.deepEqual(await locator.locate(threadId), { state: "unknown-writer" });
});
