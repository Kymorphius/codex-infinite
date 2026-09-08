import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { listDesktopProcesses, processSwitchValue, resolveDesktopExecutable } from "../src/desktop-host.mjs";

test("desktop host extracts quoted Windows and spaced macOS switch values", () => {
  assert.equal(
    processSwitchValue('ChatGPT.exe --user-data-dir="C:\\Users\\Admin\\Codex Profile" --remote-debugging-port=9231', "user-data-dir"),
    "C:\\Users\\Admin\\Codex Profile"
  );
  assert.equal(
    processSwitchValue("ChatGPT --user-data-dir=/tmp/Codex Control Console --remote-debugging-port=9231", "user-data-dir"),
    "/tmp/Codex Control Console"
  );
});

test("Windows desktop host resolves the versioned OpenAI package at runtime", async () => {
  const calls = [];
  const executable = await resolveDesktopExecutable({
    config: { appPath: "" },
    platform: "win32",
    async execFileImpl(file, args) {
      calls.push([file, args]);
      return { stdout: "C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.825.6671.0_x64__2p2nqsd0c76g0" };
    }
  });
  assert.equal(executable, path.win32.join("C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.825.6671.0_x64__2p2nqsd0c76g0", "app", "ChatGPT.exe"));
  assert.equal(calls[0][0], "powershell.exe");
  assert.match(calls[0][1].at(-1), /Get-AppxPackage/);
  assert.match(calls[0][1].at(-1), /Get-AppxPackage -AllUsers/);
  assert.match(calls[0][1].at(-1), /if \(-not \$package\)/);
});

test("Windows desktop host falls back to the exact all-users package in background service contexts", async () => {
  let query = "";
  const executable = await resolveDesktopExecutable({
    config: { appPath: "" }, platform: "win32",
    async execFileImpl(_file, args) {
      query = args.at(-1);
      return { stdout: "C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.901.6511.0_x64__2p2nqsd0c76g0" };
    }
  });
  assert.match(query, /Get-AppxPackage -Name 'OpenAI\.Codex'/);
  assert.match(query, /Get-AppxPackage -AllUsers -Name 'OpenAI\.Codex'/);
  assert.equal(executable, "C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.901.6511.0_x64__2p2nqsd0c76g0\\app\\ChatGPT.exe");
});

test("Windows desktop host returns only the selected executable processes", async () => {
  const executable = "C:\\Program Files\\WindowsApps\\OpenAI.Codex_1\\app\\ChatGPT.exe";
  const processes = await listDesktopProcesses({
    executable,
    platform: "win32",
    async execFileImpl() {
      return { stdout: JSON.stringify([
        { ProcessId: 17, ExecutablePath: executable.toLowerCase(), CommandLine: `"${executable}" --remote-debugging-port=9231` },
        { ProcessId: 18, ExecutablePath: "C:\\Elsewhere\\ChatGPT.exe", CommandLine: "ChatGPT.exe --remote-debugging-port=9231" }
      ]) };
    }
  });
  assert.deepEqual(processes.map(({ pid }) => pid), [17]);
});
