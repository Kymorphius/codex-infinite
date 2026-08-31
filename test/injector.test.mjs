import test from "node:test";
import assert from "node:assert/strict";
import { installIntoTarget } from "../src/injector.mjs";

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
  assert.deepEqual(calls.slice(0, 4).map(({ method }) => method), [
    "Page.enable",
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
  assert.deepEqual(calls.slice(0, 4).map(({ method }) => method), [
    "Page.enable",
    "Page.addScriptToEvaluateOnNewDocument",
    "Page.addScriptToEvaluateOnNewDocument",
    "Page.addScriptToEvaluateOnNewDocument"
  ]);
});
