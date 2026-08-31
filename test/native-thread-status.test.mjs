import test from "node:test";
import assert from "node:assert/strict";
import { NativeThreadStatusProvider, normalizeNativeThreadStatuses } from "../src/native-thread-status.mjs";

test("native thread statuses normalize only bounded desktop runtime states", () => {
  const active = "01a0299b-b536-7a11-8526-9b5ef4491a92";
  const idle = "01a04c23-0bf9-75b0-8030-8c664f488ac7";
  const error = "019f6a9b-e6ca-7001-8d7e-2a9deb95ebce";
  assert.deepEqual([...normalizeNativeThreadStatuses([
    { id: active, status: { type: "active", activeFlags: [] } },
    { id: idle, status: { type: "idle" } },
    { id: error, status: { type: "systemError" } },
    { id: "bad", status: { type: "active" } },
    { id: active, status: { type: "invented" } }
  ])], [[active, "active"], [idle, "completed"], [error, "error"]]);
});

test("native status provider does not infer activity from loaded writer locks", async () => {
  const provider = new NativeThreadStatusProvider({ desktopBridge: { async readThreadStatuses() { return new Map(); } } });
  assert.deepEqual([...await provider.readThreadStatuses()], []);
});
