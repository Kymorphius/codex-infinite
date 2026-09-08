import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { ensureDedicatedCodex, WRAPPER_DISABLED_FEATURES } from "../src/launcher.mjs";

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
    nativeCodexHome: "/tmp/.codex-control-console",
    perThreadContextWindow: 1_000_000,
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
    ensureDedicatedCodex(config(), { platform: "darwin", execFileImpl, fetchImpl: async () => endpoint() }),
    /完全退出专用 Codex/
  );
});

test("launcher attaches when the existing wrapper has the expected context environment", async () => {
  const current = config();
  const signature = Buffer.from(`per-thread-v6-lna-subframe-only\n${path.resolve(current.wrapperCodexHome)}\n${path.resolve(current.nativeCodexHome)}\n${current.perThreadContextWindow}`, "utf8").toString("base64url");
  const execFileImpl = async (_file, args) => {
    if (args[0] === "-axo") return { stdout: "123 /Applications/ChatGPT.app/Contents/MacOS/ChatGPT --user-data-dir=/tmp/Codex Control Console --remote-debugging-port=9231\n" };
    return { stdout: `ChatGPT CODEX_CONTROL_WRAPPER_SIGNATURE=${signature}` };
  };
  const result = await ensureDedicatedCodex(current, { platform: "darwin", execFileImpl, fetchImpl: async () => endpoint() });
  assert.equal(result.mode, "attached");
  assert.equal(result.pid, 123);
});

test("launcher scopes Chromium LNA compatibility to the dedicated wrapper process", async () => {
  assert.equal(
    WRAPPER_DISABLED_FEATURES,
    "LocalNetworkAccessForSubframeNavigations"
  );
  const launches = [];
  let fetchCount = 0;
  const spawnImpl = (_file, args, options) => {
    launches.push({ args, options });
    return { pid: 456, unref() {} };
  };
  const execFileImpl = async () => ({ stdout: "" });
  const fetchImpl = async () => {
    fetchCount += 1;
    if (fetchCount === 1) throw new Error("not running");
    return endpoint();
  };
  const result = await ensureDedicatedCodex(config(), {
    spawnImpl,
    platform: "darwin",
    accessImpl: async () => {},
    execFileImpl,
    fetchImpl,
    waitImpl: async () => {},
    maxWaitMs: 1000
  });
  assert.equal(result.mode, "launched");
  assert.equal(launches.length, 1);
  assert.equal(launches[0].args.filter((arg) => arg.startsWith("--disable-features=")).length, 1);
  assert.ok(launches[0].args.includes(`--disable-features=${WRAPPER_DISABLED_FEATURES}`));
  assert.ok(launches[0].args.some((arg) => arg.startsWith("--codex-control-wrapper-signature=")));
  assert.equal(launches[0].options.env.CODEX_HOME, config().wrapperCodexHome);
  assert.equal(launches[0].options.env.CODEX_ELECTRON_USER_DATA_PATH, config().profileDirectory);
});

test("launcher starts the Windows package with an isolated profile and verifiable fingerprint", async () => {
  const current = {
    ...config(),
    appPath: "C:\\Program Files\\WindowsApps\\OpenAI.Codex_1\\app\\ChatGPT.exe",
    profileDirectory: "C:\\Users\\Admin\\AppData\\Local\\Codex Control Console\\Profile",
    wrapperCodexHome: "C:\\Users\\Admin\\.codex-control-console",
    nativeCodexHome: "C:\\Users\\Admin\\.codex"
  };
  let launched = null;
  const execFileImpl = async (_file, args) => {
    if (!args.at(-1).includes("Get-CimInstance")) throw new Error("unexpected package lookup");
    if (!launched) return { stdout: "" };
    const command = [
      `"${current.appPath}"`,
      ...launched.args.map((arg) => arg.includes(" ") ? `"${arg.replace("=", '=\"')}\"` : arg)
    ].join(" ");
    return { stdout: JSON.stringify({ ProcessId: 919, ExecutablePath: current.appPath, CommandLine: command }) };
  };
  let fetches = 0;
  const result = await ensureDedicatedCodex(current, {
    platform: "win32",
    execFileImpl,
    accessImpl: async () => {},
    spawnImpl(executable, args, options) {
      launched = { executable, args, options };
      return { pid: 919, unref() {} };
    },
    fetchImpl: async () => {
      fetches += 1;
      if (fetches === 1) throw new Error("not running");
      return endpoint();
    },
    waitImpl: async () => {},
    maxWaitMs: 1000
  });
  assert.equal(result.mode, "launched");
  assert.equal(result.pid, 919);
  assert.equal(launched.executable, current.appPath);
  assert.ok(launched.args.includes(`--user-data-dir=${current.profileDirectory}`));
  assert.ok(launched.args.includes("--remote-debugging-address=127.0.0.1"));
  assert.equal(launched.options.env.CODEX_ELECTRON_USER_DATA_PATH, current.profileDirectory);
  assert.equal(launched.options.env.CODEX_HOME, current.nativeCodexHome);
  assert.equal(launched.options.windowsHide, false);
});
