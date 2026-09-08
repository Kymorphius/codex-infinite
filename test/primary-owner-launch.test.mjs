import test from "node:test";
import assert from "node:assert/strict";
import { PrimaryOwnerLauncher } from "../src/primary-owner-launch.mjs";

const config = {
  appPath: "/Applications/ChatGPT.app",
  profileDirectory: "/Users/test/Library/Application Support/Codex Control Console",
  primaryProfileDirectory: "/Users/test/Library/Application Support/Codex",
  primaryCdpHost: "127.0.0.1",
  primaryCdpPort: 9232,
  primaryCdpOrigin: "http://127.0.0.1:9232"
};

test("primary launcher refuses maintenance while native work is active", async () => {
  const launcher = new PrimaryOwnerLauncher({ config });
  await assert.rejects(() => launcher.relaunch({ confirmIdle: true, activeThreadIds: ["thread"] }), /仍有 1 个任务在运行/);
});

test("primary launcher relaunches only the primary profile with loopback CDP", async () => {
  let psCalls = 0;
  const killed = [];
  const spawned = [];
  const launcher = new PrimaryOwnerLauncher({
    config,
    accessImpl: async () => {},
    async execFileImpl() {
      psCalls += 1;
      return { stdout: psCalls === 1 ? "77 /Applications/ChatGPT.app/Contents/MacOS/ChatGPT\n88 /Applications/ChatGPT.app/Contents/MacOS/ChatGPT --user-data-dir=/Users/test/Library/Application Support/Codex Control Console" : "" };
    },
    killImpl(pid, signal) { killed.push([pid, signal]); },
    async waitImpl() {},
    spawnImpl(executable, args, options) { spawned.push([executable, args, options]); return { unref() {} }; }
  });
  await launcher.relaunch({ confirmIdle: true, activeThreadIds: [] });
  assert.deepEqual(killed, [[77, "SIGTERM"]]);
  assert.ok(spawned[0][1].includes("--remote-debugging-address=127.0.0.1"));
  assert.ok(spawned[0][1].includes("--remote-debugging-port=9232"));
  assert.equal(spawned[0][2].env.CODEX_HOME, undefined);
});
