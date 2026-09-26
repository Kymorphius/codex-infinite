import test from "node:test";
import assert from "node:assert/strict";
import { bundledCodexCandidates, resolveBundledCodexPath } from "../src/codex-cli-path.mjs";
import { getConfig } from "../src/config.mjs";

const appPath = "/Applications/ChatGPT.app";
const candidates = bundledCodexCandidates(appPath, "darwin");

function statFor(existing = []) {
  const files = new Set(existing);
  return (candidate) => {
    if (!files.has(candidate)) {
      const error = new Error("missing");
      error.code = "ENOENT";
      throw error;
    }
    return { isFile: () => true };
  };
}

test("bundled CLI discovery prefers the ChatGPT 26 launcher", () => {
  assert.equal(resolveBundledCodexPath(appPath, { platform: "darwin", statSync: statFor(candidates) }), candidates[0]);
});

test("bundled CLI discovery supports nested and legacy layouts", () => {
  assert.equal(resolveBundledCodexPath(appPath, { platform: "darwin", statSync: statFor([candidates[1], candidates[2]]) }), candidates[1]);
  assert.equal(resolveBundledCodexPath(appPath, { platform: "darwin", statSync: statFor([candidates[2]]) }), candidates[2]);
  assert.equal(resolveBundledCodexPath(appPath, { platform: "darwin", statSync: statFor() }), candidates[2]);
});

test("explicit CLI configuration remains authoritative", () => {
  const config = getConfig({ CODEX_CONTROL_CODEX_PATH: "/opt/custom/codex" }, "/Users/test", "darwin");
  assert.equal(config.codexPath, "/opt/custom/codex");
});
