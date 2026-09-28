import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findModuleGraphProblems, moduleEntries } from "../scripts/module-graph.mjs";

function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ccc-module-graph-"));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), content);
  }
  return root;
}

const page = '<script src="/theme.js"></script><script src="/app.js" type="module"></script>';

test("module entries come from module script tags only", () => {
  const root = fixture({ "index.html": page, "app.js": "", "theme.js": "" });
  assert.deepEqual(moduleEntries(root).map(entry => path.basename(entry.file)), ["app.js"]);
});

test("a missing nested import is reported with its importer", () => {
  // Regression: features/terminal/prompt.js was absent, so app.js never announced readiness.
  const root = fixture({
    "index.html": page,
    "app.js": 'import { start } from "./features/terminal/session.js";\nstart();',
    "features/terminal/session.js": 'import { terminalChoicePrompt } from "./prompt.js";\nexport function start() {}'
  });
  assert.deepEqual(findModuleGraphProblems(root).problems, ["missing module features/terminal/prompt.js (imported by features/terminal/session.js)"]);
});

test("a missing named export is reported", () => {
  const root = fixture({ "index.html": page, "app.js": 'import { a, b as c } from "/lib.js";', "lib.js": "export const a = 1;" });
  assert.deepEqual(findModuleGraphProblems(root).problems, ["missing export b in lib.js (imported by app.js)"]);
});

test("a complete graph passes, including re-exports and dynamic imports", () => {
  const root = fixture({
    "index.html": page,
    "app.js": 'import { x } from "./barrel.js";\nimport("./lazy.js");',
    "barrel.js": 'export * from "./x.js";',
    "x.js": "export function x() {}",
    "lazy.js": "export default 1;"
  });
  assert.deepEqual(findModuleGraphProblems(root), { modules: 4, problems: [] });
});

test("the shipped public module graph is complete", () => {
  const publicRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
  assert.deepEqual(findModuleGraphProblems(publicRoot).problems, []);
});
