import test from "node:test";
import assert from "node:assert/strict";
import { installIntoTarget } from "../src/injector.mjs";

test("injector prepares CSP before injection without reloading the native page", async () => {
  const calls = [];
  const connection = {
    async send(method, params) {
      calls.push({ method, params });
      return {};
    },
    async evaluate(source) {
      calls.push({ method: "evaluate", source });
      return {};
    }
  };
  await installIntoTarget(connection, "http://127.0.0.1:47831");
  assert.deepEqual(calls.slice(0, 2), [
    { method: "Page.enable", params: undefined },
    { method: "Page.setBypassCSP", params: { enabled: true } }
  ]);
  assert.equal(calls.some((call) => call.method === "Page.reload"), false);
  assert.equal(calls.at(-1).method, "evaluate");
});
