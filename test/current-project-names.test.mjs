import test from "node:test";
import assert from "node:assert/strict";
import path from 'node:path';
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

test('prepared roots preserve closest match, separator boundaries and stable ties', () => {
  const nested = createCurrentProjectNameLookup({ 'local-projects': {
    parent: { name: '父项目', rootPaths: ['/fixture/project'] },
    child: { name: '子项目', rootPaths: ['/fixture/project/nested'] },
    tie: { name: '另一个名称', rootPaths: ['/fixture/project/nested/'] },
    windows: { name: 'Windows', rootPaths: ['D:\\Work\\Project'] },
  } });
  assert.equal(nested.nameFor('/fixture/project/nested/src'), '另一个名称');
  assert.equal(nested.nameFor('/fixture/project/src'), '父项目');
  assert.equal(nested.nameFor('/fixture/project-sibling/src'), null);
  assert.equal(nested.nameFor('d:\\work\\project\\src'), 'Windows');
  assert.equal(nested.nameFor('D:\\Work\\ProjectOther'), null);
  assert.equal(nested.nameFor('/fixture/Project'), null);
  const tied = createCurrentProjectNameLookup({ 'local-projects': {
    first: { name: '第一个', rootPaths: ['/fixture/shared'] },
    second: { name: '第二个', rootPaths: ['/fixture/shared'] },
  } });
  assert.equal(tied.nameFor('/fixture/shared/file'), '第一个');
});

test('prepared lookup owns its snapshot while a new lookup observes renamed projects', () => {
  const state = { 'local-projects': { one: { name: '原名称', rootPaths: ['/fixture/one'] } } };
  const old = createCurrentProjectNameLookup(state);
  state['local-projects'].one.name = '新名称';
  state['local-projects'].one.rootPaths.push('/fixture/two');
  assert.equal(old.nameFor('/fixture/one'), '原名称');
  assert.equal(old.nameFor('/fixture/two'), null);
  const next = createCurrentProjectNameLookup(state);
  assert.equal(next.nameFor('/fixture/one'), '新名称');
  assert.equal(next.nameFor('/fixture/two'), '新名称');
});

test('prepared direct roots retain ambiguous worktree rejection', () => {
  const ambiguous = createCurrentProjectNameLookup({ 'local-projects': {
    one: { name: '项目一', rootPaths: ['/fixture/one/shared'] },
    two: { name: '项目二', rootPaths: ['/fixture/two/shared'] },
  } });
  assert.equal(ambiguous.nameFor('/Users/demo/.codex/worktrees/id/shared/src'), null);
  assert.equal(ambiguous.nameFor('/fixture/two/shared'), '项目二');
});

test('batch task lookups reuse root normalization instead of repeating it for each task', () => {
  const original = path.posix.normalize;
  let normalizations = 0;
  path.posix.normalize = value => { normalizations++; return original(value); };
  try {
    const state = { 'local-projects': Object.fromEntries(Array.from({ length: 100 }, (_, i) =>
      [String(i), { name: `项目${i}`, rootPaths: [`/fixture/project-${i}`] }])) };
    const prepared = createCurrentProjectNameLookup(state);
    for (let i = 0; i < 1000; i++) assert.equal(prepared.nameFor(`/fixture/project-${i % 100}/src`), `项目${i % 100}`);
    assert.ok(normalizations <= 1200, `repeated immutable normalization: ${normalizations}`);
  } finally { path.posix.normalize = original; }
});
