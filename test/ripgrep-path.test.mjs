import test from "node:test";
import assert from "node:assert/strict";
import { bundledRipgrepCandidates, resolveRipgrepPath } from "../src/ripgrep-path.mjs";

const winExe = "C:\\Program Files\\WindowsApps\\OpenAI.Codex_1_x64__id\\app\\ChatGPT.exe";
const winRg = "C:\\Program Files\\WindowsApps\\OpenAI.Codex_1_x64__id\\app\\resources\\rg.exe";
const file = { isFile: () => true };

test("bundled ripgrep sits in the desktop package resources", () => {
  assert.deepEqual(bundledRipgrepCandidates(winExe, "win32"), [winRg]);
  assert.deepEqual(bundledRipgrepCandidates("/Applications/ChatGPT.app/Contents/MacOS/ChatGPT", "darwin"), ["/Applications/ChatGPT.app/Contents/Resources/rg"]);
  assert.deepEqual(bundledRipgrepCandidates(winExe, "linux"), []);
  assert.deepEqual(bundledRipgrepCandidates(null, "win32"), []);
});

test("ripgrep resolves override, then the bundled binary, then PATH", async () => {
  const config = { appPath: winExe };
  assert.equal(await resolveRipgrepPath({ config, env: { CODEX_CONTROL_RG_PATH: "D:\\tools\\rg.exe" }, platform: "win32", statSync: () => { throw new Error("unused"); } }), "D:\\tools\\rg.exe");
  assert.equal(await resolveRipgrepPath({ config, env: {}, platform: "win32", statSync: target => { assert.equal(target, winRg); return file; } }), winRg);
  assert.equal(await resolveRipgrepPath({ config, env: {}, platform: "win32", statSync: () => { throw Object.assign(new Error("gone"), { code: "ENOENT" }); } }), "rg");
  // Regression: Windows has no rg on PATH; a failed package lookup must still leave a usable default.
  assert.equal(await resolveRipgrepPath({ config: {}, env: {}, platform: "win32", execFileImpl: async () => { throw new Error("no package"); } }), "rg");
});
