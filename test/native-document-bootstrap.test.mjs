import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { deferNativeDocumentSource, waitForReloadedNativeDocument } from "../src/native-document-bootstrap.mjs";

function readyContext(overrides = {}) {
  return { document: { documentElement: {}, body: {} }, crypto: { randomUUID() {} }, localStorage: { length: 0 }, setTimeout() {}, window: { addEventListener() { throw new Error("unexpected deferral"); } }, ...overrides };
}

test("native document source runs immediately when the DOM and app runtime exist", () => {
  const context = readyContext();
  vm.runInNewContext(deferNativeDocumentSource("globalThis.installed = true;"), context);
  assert.equal(context.installed, true);
});

test("native document source waits once for DOMContentLoaded", () => {
  let listener;
  const context = readyContext({ document: { documentElement: null, body: null }, window: { addEventListener(type, callback, options) { listener = { type, callback, options }; } } });
  vm.runInNewContext(deferNativeDocumentSource("globalThis.installed = true;"), context);
  assert.equal(context.installed, undefined);
  assert.equal(listener.type, "DOMContentLoaded");
  assert.equal(listener.options.once, true);
  context.document.documentElement = {};
  context.document.body = {};
  listener.callback();
  assert.equal(context.installed, true);
});

test("native document source waits for the app crypto and storage runtime", () => {
  let retry;
  const context = readyContext({ crypto: {}, setTimeout(callback, delay) { retry = { callback, delay }; } });
  vm.runInNewContext(deferNativeDocumentSource("globalThis.installed = true;"), context);
  assert.equal(context.installed, undefined);
  assert.equal(retry.delay, 50);
  context.crypto.randomUUID = () => "ready";
  retry.callback();
  assert.equal(context.installed, true);
});

test("reload readiness rejects the previous document token", async () => {
  const values = [false, true];
  const expressions = [];
  const connection = { async evaluate(expression) { expressions.push(expression); return values.shift(); } };
  await waitForReloadedNativeDocument(connection, "old-document", { attempts: 2, wait: async () => {} });
  assert.equal(expressions.length, 2);
  assert.match(expressions[0], /token !== "old-document"/);
  assert.match(expressions[0], /document\.documentElement && document\.body/);
});
