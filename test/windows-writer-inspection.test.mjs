import test from "node:test";
import assert from "node:assert/strict";
import { inspectWindowsWriter } from "../src/windows-writer-inspection.mjs";

test("Windows writer inspection normalizes bounded lock holders and process ancestry", async () => {
  const result = await inspectWindowsWriter("C:\\Users\\Admin\\.codex\\thread-writer-locks\\thread.lock", {
    async execFileImpl(file, args, options) {
      assert.equal(file, "powershell.exe");
      assert.match(args.at(-1), /CodexRestartManagerLock/);
      assert.equal(options.windowsHide, true);
      assert.equal(options.env.CODEX_CONTROL_LOCK_PATH, "C:\\Users\\Admin\\.codex\\thread-writer-locks\\thread.lock");
      return { stdout: JSON.stringify({
        HolderPids: [40],
        Processes: [
          { ProcessId: 40, ParentProcessId: 20, ExecutablePath: "C:\\codex.exe", CommandLine: "codex app-server" },
          { ProcessId: 20, ParentProcessId: 1, ExecutablePath: "C:\\OpenAI.Codex_1\\app\\ChatGPT.exe", CommandLine: "ChatGPT.exe" }
        ]
      }) };
    }
  });
  assert.equal(result.state, "available");
  assert.deepEqual(result.holderPids, [40]);
  assert.equal(result.processes.get(40).parentPid, 20);
});

test("Windows writer inspection fails closed on malformed provider output", async () => {
  const result = await inspectWindowsWriter("lock", { async execFileImpl() { return { stdout: "not-json" }; } });
  assert.equal(result.state, "unavailable");
});
