import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { ensureDedicatedCodex } from "../src/launcher.mjs";

function config() {
  return {
    dashboardHost: "127.0.0.1",
    cdpHost: "127.0.0.1",
    dashboardPort: 47831,
    cdpPort: 9231,
    dashboardOrigin: "http://127.0.0.1:47831",
    cdpOrigin: "http://127.0.0.1:9231",
    profileDirectory: "/tmp/Codex Control Console",
    wrapperCodexHome: "/tmp/.codex-control-console",
    wrapperContextWindow: 1_000_000,
    appPath: "/Applications/ChatGPT.app"
  };
}

function endpoint() {
  return { ok: true, status: 200, json: async () => ({ Browser: "mock" }) };
}

test("launcher refuses to attach to a wrapper process with stale context environment", async () => {
  const execFileImpl = async (_file, args) => {
    if (args[0] === "-axo") return { stdout: "123 /Applications/ChatGPT.app/Contents/MacOS/ChatGPT --user-data-dir=/tmp/Codex Control Console --remote-debugging-port=9231\n" };
    return { stdout: "ChatGPT CODEX_CONTROL_WRAPPER_SIGNATURE=stale" };
  };
  await assert.rejects(
    ensureDedicatedCodex(config(), { execFileImpl, fetchImpl: async () => endpoint() }),
    /完全退出专用 Codex/
  );
});

test("launcher attaches when the existing wrapper has the expected context environment", async () => {
  const current = config();
  const signature = Buffer.from(`${path.resolve(current.wrapperCodexHome)}\n${current.wrapperContextWindow}`, "utf8").toString("base64url");
  const execFileImpl = async (_file, args) => {
    if (args[0] === "-axo") return { stdout: "123 /Applications/ChatGPT.app/Contents/MacOS/ChatGPT --user-data-dir=/tmp/Codex Control Console --remote-debugging-port=9231\n" };
    return { stdout: `ChatGPT CODEX_CONTROL_WRAPPER_SIGNATURE=${signature}` };
  };
  const result = await ensureDedicatedCodex(current, { execFileImpl, fetchImpl: async () => endpoint() });
  assert.equal(result.mode, "attached");
  assert.equal(result.pid, 123);
});
