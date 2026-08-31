import test from "node:test";
import assert from "node:assert/strict";
import { NativeOwnerInjector } from "../src/native-owner-injector.mjs";

test("primary owner injector installs only native bridges and does not add the dashboard shell", async () => {
  const sent = [];
  const evaluated = [];
  let closed = false;
  const connection = {
    async connect() {},
    async send(method, params) { sent.push([method, params]); },
    async evaluate(source) { evaluated.push(source); },
    onEvent() { return () => {}; },
    async close() { closed = true; }
  };
  const injector = new NativeOwnerInjector({
    cdpOrigin: "http://127.0.0.1:9232",
    contextWindowStore: { list() { return []; } },
    async discover(origin) { assert.equal(origin, "http://127.0.0.1:9232"); return [{ id: "primary", webSocketDebuggerUrl: "ws://primary" }]; },
    choose(targets) { return targets[0]; },
    connectionFactory() { return connection; },
    logger: { warn() {} }
  });
  await injector.sync();
  assert.ok(sent.some(([method]) => method === "Runtime.addBinding"));
  assert.ok(evaluated.some((source) => source.includes("__codexControlConsoleApplyThreadSettings")));
  assert.equal(evaluated.some((source) => source.includes("data-codex-control-console-frame")), false);
  await injector.stop();
  assert.equal(closed, true);
});

test("primary owner injector resets a stale connection so the next poll can reattach", async () => {
  let connections = 0;
  const injector = new NativeOwnerInjector({
    cdpOrigin: "http://127.0.0.1:9232",
    async discover() { return [{ id: "primary", webSocketDebuggerUrl: "ws://primary" }]; },
    choose(targets) { return targets[0]; },
    connectionFactory() {
      connections += 1;
      return {
        async connect() {}, async send() {}, onEvent() { return () => {}; }, async close() {},
        async evaluate() { if (connections === 1) throw new Error("stale"); }
      };
    },
    logger: { warn() {} }
  });
  await injector.sync();
  await injector.sync();
  assert.equal(connections, 2);
  await injector.stop();
});
