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
    sidebarLabelProvider: { async read() { return [{ threadId: "01a05852-9f3a-77b2-8ad3-74aa8e49c7c3", projectLabel: "看板", deviceLabel: "本地" }]; } },
    remoteSidebarProvider: { async read() { return [{ id: "windows-pc", name: "Windows Desktop", status: "connected", projectCount: 1, conversationCount: 2, projects: [] }]; } },
    async discover(origin) { assert.equal(origin, "http://127.0.0.1:9232"); return [{ id: "primary", webSocketDebuggerUrl: "ws://primary" }]; },
    choose(targets) { return targets[0]; },
    connectionFactory() { return connection; },
    logger: { warn() {} }
  });
  await injector.sync();
  assert.equal(sent.filter(([method]) => method === "Runtime.addBinding").length, 4);
  assert.equal(evaluated.filter((source) => source.includes("data-codex-control-console-chat-title") && source.includes("聊天")).length, 1);
  await injector.sync();
  assert.equal(sent.filter(([method]) => method === "Runtime.addBinding").length, 6);
  assert.equal(evaluated.filter((source) => source.includes("data-codex-control-console-chat-title") && source.includes("聊天")).length, 2);
  assert.ok(evaluated.some((source) => source.includes("__codexControlConsoleApplyThreadSettings")));
  assert.ok(evaluated.some((source) => source.includes("data-codex-control-console-sidebar-labels")));
  assert.ok(evaluated.some((source) => source.includes("__codexControlConsoleSetSidebarLabels") && source.includes("看板")));
  assert.ok(evaluated.some((source) => source.includes("data-codex-control-console-remote-sidebar")));
  assert.ok(evaluated.some((source) => source.includes("__codexControlConsoleSetRemoteSidebar") && source.includes("Windows Desktop")));
  assert.ok(evaluated.some((source) => source.includes("data-codex-control-console-attention-sticky") && source.includes("position:sticky")));
  assert.ok(evaluated.some((source) => source.includes("data-codex-control-console-chat-title") && source.includes("聊天")));
  assert.ok(evaluated.some((source) => source.includes("data-codex-control-console-open-local-project") && source.includes("打开本地项目")));
  assert.equal(evaluated.some((source) => /createElement\(['\"]iframe/.test(source)), false);
  await injector.stop();
  assert.equal(closed, true);
});

test("primary owner injector reapplies version-guarded native injections when the target id is unchanged", async () => {
  const evaluated = [];
  const connection = {
    async connect() {}, async send() {},
    async evaluate(source) { evaluated.push(source); },
    onEvent() { return () => {}; }, async close() {}
  };
  const injector = new NativeOwnerInjector({
    cdpOrigin: "http://127.0.0.1:9232",
    async discover() { return [{ id: "primary", webSocketDebuggerUrl: "ws://primary" }]; },
    choose(targets) { return targets[0]; },
    connectionFactory() { return connection; },
    logger: { warn() {} }
  });

  await injector.sync();
  evaluated.length = 0;
  await injector.sync();

  assert.ok(evaluated.some((source) => source.includes("__codexControlConsoleChatSectionVersion")));
  assert.ok(evaluated.some((source) => source.includes("__codexControlConsoleAttentionStickyVersion")));
  assert.ok(evaluated.some((source) => source.includes("__codexControlConsoleSidebarLabelVersion")));
  assert.ok(evaluated.some((source) => source.includes("__codexControlConsoleRemoteSidebarVersion")));
  assert.ok(evaluated.some((source) => source.includes("__codexControlConsoleOpenLocalProjectVersion")));
  await injector.stop();
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
