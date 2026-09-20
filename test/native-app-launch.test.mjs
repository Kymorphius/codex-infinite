import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { NativeAppLaunchService, nativeAppLaunchPlan } from "../src/native-app-launch.mjs";
import { createNativeAppLaunchHttpHandler } from "../src/native-app-launch-http.mjs";

test("native launcher opens a separate installed native application profile without wrapper arguments", async () => {
  const config = { appPath: "/Applications/ChatGPT.app", primaryProfileDirectory: "/Users/example/Library/Application Support/Codex" };
  assert.deepEqual(nativeAppLaunchPlan(config, "darwin"), { executable: "/usr/bin/open", args: ["-n", "-a", "/Applications/ChatGPT.app", "--args", "--user-data-dir=/Users/example/Library/Application Support/Codex"], options: { detached: true, stdio: "ignore" } });
  const calls = [];
  const service = new NativeAppLaunchService({ config, platform: "darwin", resolveExecutable: async () => "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT", spawn: (...args) => { calls.push(args); return { once(event, handler) { if (event === "spawn") handler(); }, unref() { calls.push("unref"); } }; } });
  assert.deepEqual(await service.launch(), { started: true });
  assert.deepEqual(calls, [["/usr/bin/open", ["-n", "-a", "/Applications/ChatGPT.app", "--args", "--user-data-dir=/Users/example/Library/Application Support/Codex"], { detached: true, stdio: "ignore" }], "unref"]);
});

test("native launcher endpoint requires the dashboard origin and accepts no launch parameters", async () => {
  let launches = 0;
  const handler = createNativeAppLaunchHttpHandler({ dashboardOrigin: "http://127.0.0.1:47831", service: { async launch() { launches++; return { started: true }; } } });
  const invoke = async (body, origin) => {
    const request = Readable.from([Buffer.from(JSON.stringify(body))]); request.method = "POST"; request.headers = { origin, "content-type": "application/json" };
    const response = { writeHead(code) { this.code = code; }, end() {} };
    await handler(request, response, new URL("http://localhost/api/native-app/launch")); return response.code;
  };
  await assert.rejects(invoke({}, "https://evil.example"), { statusCode: 403 });
  await assert.rejects(invoke({ appPath: "/tmp/evil" }, "http://127.0.0.1:47831"), { statusCode: 400 });
  assert.equal(await invoke({}, "http://127.0.0.1:47831"), 202); assert.equal(launches, 1);
});
