import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { isMainModuleUrl } from "../src/main.mjs";

test("main entry detection compares normalized file URLs", () => {
  const entryPath = process.platform === "win32" ? "C:\\App\\src\\main.mjs" : "/tmp/App/src/main.mjs";
  assert.equal(isMainModuleUrl(pathToFileURL(entryPath).href, entryPath), true);
  assert.equal(isMainModuleUrl(pathToFileURL(`${entryPath}.other`).href, entryPath), false);
});
