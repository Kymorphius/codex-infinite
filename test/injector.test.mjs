import test from "node:test";
import assert from "node:assert/strict";
import { CodexInjector, installIntoTarget } from "../src/injector.mjs";

test("injector reloads once after enabling target-scoped CSP bypass", async () => {
  const calls = [];
  const connection = {
    async send(method, params) {
      calls.push({ method, params });
      return {};
    },
    async evaluate(source) {
      calls.push({ method: "evaluate", source });
      if (source.includes("CspBypassReloaded")) return false;
      if (source.includes("document.readyState")) return true;
      return {};
    }
  };
  await installIntoTarget(connection, "http://127.0.0.1:47831");
  assert.deepEqual(calls.slice(0, 10).map(({ method }) => method), [
    "Page.enable",
    "Page.addScriptToEvaluateOnNewDocument",
    "Page.addScriptToEvaluateOnNewDocument",
    "Page.addScriptToEvaluateOnNewDocument",
    "Page.addScriptToEvaluateOnNewDocument",
    "Page.addScriptToEvaluateOnNewDocument",
    "Page.addScriptToEvaluateOnNewDocument",
    "Page.addScriptToEvaluateOnNewDocument",
    "Page.addScriptToEvaluateOnNewDocument",
    "Page.addScriptToEvaluateOnNewDocument"
  ]);
  assert.deepEqual(calls.find((call) => call.method === "Page.setBypassCSP"), {
    method: "Page.setBypassCSP",
    params: { enabled: true }
  });
  assert.deepEqual(calls.find((call) => call.method === "Page.reload"), {
    method: "Page.reload",
    params: { ignoreCache: false }
  });
  assert.ok(calls.findIndex((call) => call.method === "Page.setBypassCSP") < calls.findIndex((call) => call.method === "Page.reload"));
  assert.equal(calls.some((call) => call.method === "Page.setDocumentContent"), false);
  assert.equal(calls.at(-1).method, "evaluate");
});

test("injector does not reload a document already created under CSP bypass", async () => {
  const calls = [];
  const connection = {
    async send(method, params) { calls.push({ method, params }); return {}; },
    async evaluate(source) {
      calls.push({ method: "evaluate", source });
      if (source.includes("CspBypassReloaded")) return true;
      return {};
    }
  };
  await installIntoTarget(connection, "http://127.0.0.1:47831");
  assert.equal(calls.some((call) => call.method === "Page.reload"), false);
  assert.equal(calls.some((call) => call.method === "Page.setBypassCSP"), true);
  assert.deepEqual(calls.slice(0, 10).map(({ method }) => method), [
    "Page.enable",
    "Page.addScriptToEvaluateOnNewDocument",
    "Page.addScriptToEvaluateOnNewDocument",
    "Page.addScriptToEvaluateOnNewDocument",
    "Page.addScriptToEvaluateOnNewDocument",
    "Page.addScriptToEvaluateOnNewDocument",
    "Page.addScriptToEvaluateOnNewDocument",
    "Page.addScriptToEvaluateOnNewDocument",
    "Page.addScriptToEvaluateOnNewDocument",
    "Page.addScriptToEvaluateOnNewDocument"
  ]);
});

test("injector can explicitly suppress the compatibility reload", async () => {
  const calls = [];
  const connection = {
    async send(method, params) { calls.push({ method, params }); return {}; },
    async evaluate(source) { calls.push({ method: "evaluate", source }); return false; }
  };
  await installIntoTarget(connection, "http://127.0.0.1:47831", {
    reloadAfterCspBypass: false,
    remoteSidebar: [{ id: "windows-pc", name: "Windows Desktop", status: "connected", projects: [] }]
  });
  assert.equal(calls.some((call) => call.method === "Page.setBypassCSP"), true);
  assert.equal(calls.some((call) => call.method === "Page.reload"), false);
  assert.equal(calls.some((call) => call.method === "evaluate" && call.source.includes("__codexControlConsoleSetRemoteSidebar") && call.source.includes("Windows Desktop")), true);
  assert.equal(calls.at(-1).method, "evaluate");
});

test("injector reasserts target-scoped CSP bypass after a renderer changes behind the same target", async () => {
  const calls = [];
  const connection = {
    async send(method, params) { calls.push({ method, params }); return {}; },
    async evaluate(source) {
      calls.push({ method: "evaluate", source });
      if (source.includes("CspBypassReloaded")) return false;
      if (source.includes("document.readyState")) return true;
      return {};
    }
  };
  await installIntoTarget(connection, "http://127.0.0.1:47831", { reloadAfterCspBypass: false });
  await installIntoTarget(connection, "http://127.0.0.1:47831", { reloadAfterCspBypass: false });
  assert.equal(calls.filter((call) => call.method === "Page.setBypassCSP").length, 2);
  assert.equal(calls.filter((call) => call.method === "Page.addScriptToEvaluateOnNewDocument").length, 15);
  assert.equal(calls.some((call) => call.method === "Page.reload"), false);
});

test("injector relaunches a missing dedicated Codex target before the next sync", async () => {
  let recoveries = 0;
  const injector = new CodexInjector({
    cdpOrigin: "http://127.0.0.1:9231",
    dashboardUrl: "http://127.0.0.1:47831",
    recoverTarget: async () => { recoveries += 1; },
    logger: { warn() {} }
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    async json() { return recoveries ? [{ type: "page", id: "app", url: "app://-/index.html", webSocketDebuggerUrl: "ws://127.0.0.1:9231/app" }] : []; }
  });
  class FakeSocket {
    constructor() { this.readyState = 1; queueMicrotask(() => this.listeners.open?.({})); }
    addEventListener(name, listener) { this.listeners ||= {}; this.listeners[name] = listener; }
    send(payload) { const { id, method } = JSON.parse(payload); const result = method === "Runtime.evaluate" ? { result: { value: true } } : {}; queueMicrotask(() => this.listeners.message?.({ data: JSON.stringify({ id, result }) })); }
    close() { this.readyState = 3; }
  }
  const originalSocket = globalThis.WebSocket;
  globalThis.WebSocket = FakeSocket;
  try { await injector.sync(); }
  finally { globalThis.fetch = originalFetch; globalThis.WebSocket = originalSocket; await injector.stop(); }
  assert.equal(recoveries, 1);
  assert.equal(injector.targetId, null);
});

test("injector relaunches dedicated Codex when the CDP endpoint disappears during an update", async () => {
  let recoveries = 0;
  let fetches = 0;
  const injector = new CodexInjector({
    cdpOrigin: "http://127.0.0.1:9231",
    dashboardUrl: "http://127.0.0.1:47831",
    recoverTarget: async () => { recoveries += 1; },
    logger: { warn() {} }
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetches += 1;
    if (fetches === 1) throw new Error("connection refused");
    return {
      ok: true,
      async json() { return [{ type: "page", id: "app", url: "app://-/index.html", webSocketDebuggerUrl: "ws://127.0.0.1:9231/app" }]; }
    };
  };
  class FakeSocket {
    constructor() { this.readyState = 1; queueMicrotask(() => this.listeners.open?.({})); }
    addEventListener(name, listener) { this.listeners ||= {}; this.listeners[name] = listener; }
    send(payload) { const { id, method } = JSON.parse(payload); const result = method === "Runtime.evaluate" ? { result: { value: true } } : {}; queueMicrotask(() => this.listeners.message?.({ data: JSON.stringify({ id, result }) })); }
    close() { this.readyState = 3; }
  }
  const originalSocket = globalThis.WebSocket;
  globalThis.WebSocket = FakeSocket;
  try { await injector.sync(); }
  finally { globalThis.fetch = originalFetch; globalThis.WebSocket = originalSocket; await injector.stop(); }
  assert.equal(recoveries, 1);
  assert.equal(fetches, 2);
  assert.equal(injector.targetId, null);
});
