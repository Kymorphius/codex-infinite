import test from "node:test";
import assert from "node:assert/strict";
import { createCurrentProjectNameLookup } from "../src/current-project-names.mjs";

const lookup = createCurrentProjectNameLookup({
  "local-projects": {
    board: { name: "看板", rootPaths: ["/Users/demo/333.dev/mulitca"] },
    devspace: { name: "开发空间", rootPaths: ["/Users/demo/333.dev/devspace", "/Users/demo/333.dev/chatgptbox"] },
    voice: { name: "语音助手", rootPaths: ["/Users/demo/333.dev/PAVoice"] },
    windows: { name: "资产管理", rootPaths: ["D:\\333.dev\\Assets"] }
  }
});

test("current project names use renamed and longest containing roots", () => {
  assert.equal(lookup.nameFor("/Users/demo/333.dev/mulitca"), "看板");
  assert.equal(lookup.nameFor("/Users/demo/333.dev/chatgptbox/src"), "开发空间");
});

test("current project names recognize unambiguous Codex worktrees", () => {
  assert.equal(lookup.nameFor("/Users/demo/.codex/worktrees/1234/PAVoice"), "语音助手");
});

test("current project names compare Windows roots case-insensitively", () => {
  assert.equal(lookup.nameFor("d:\\333.DEV\\ASSETS\\src"), "资产管理");
});

test("current project names fail closed for unknown or malformed state", () => {
  assert.equal(lookup.nameFor("/Users/demo/unknown"), null);
  assert.equal(createCurrentProjectNameLookup({ "local-projects": [] }).nameFor("/work/demo"), null);
});
