import test from "node:test";
import assert from "node:assert/strict";
import { NativeDesktopRouter } from "../src/native-desktop-router.mjs";

test("desktop router connects only to the writer-selected surface", async () => {
  const calls = [];
  const connection = { async connect() { calls.push("connect"); } };
  const router = new NativeDesktopRouter({
    writerLocator: { async locate() { return { state: "ready", surface: "primary-native", bridge: "writer-matched", cdpOrigin: "http://127.0.0.1:9232" }; } },
    async discover(origin) { calls.push(origin); return [{ webSocketDebuggerUrl: "ws://primary" }]; },
    choose(targets) { return targets[0]; },
    connectionFactory(url) { calls.push(url); return connection; }
  });
  assert.deepEqual(await router.connect("thread"), { connection, ownerSurface: "primary-native", ownerBridge: "writer-matched" });
  assert.deepEqual(calls, ["http://127.0.0.1:9232", "ws://primary", "connect"]);
});

test("desktop router never falls back when the primary writer bridge is unavailable", async () => {
  let discoveries = 0;
  const router = new NativeDesktopRouter({
    writerLocator: { async locate() { return { state: "bridge-unavailable", surface: "primary-native" }; } },
    async discover() { discoveries += 1; return []; }
  });
  await assert.rejects(() => router.connect("thread"), /未启用.*未改用另一套后台进程/);
  assert.equal(discoveries, 0);
});
