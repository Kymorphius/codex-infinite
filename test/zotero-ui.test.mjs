import test from "node:test";
import assert from "node:assert/strict";
import {
  formatCreatorLines,
  formatTagLines,
  parseCreatorLines,
  splitLines,
  writeStatusLabel
} from "../public/features/zotero/format.js";

test("Zotero creator lines preserve creator roles and structured names", () => {
  assert.deepEqual(parseCreatorLines("author|Ada Lovelace\neditor|Grace Hopper\n机构作者"), [
    { creatorType: "author", firstName: "Ada", lastName: "Lovelace" },
    { creatorType: "editor", name: "Grace Hopper" },
    { creatorType: "author", name: "机构作者" }
  ]);
  assert.equal(formatCreatorLines([
    { creatorType: "author", firstName: "Ada", lastName: "Lovelace" },
    { creatorType: "editor", name: "Grace Hopper" }
  ]), "author|Ada Lovelace\neditor|Grace Hopper");
});

test("Zotero line and tag formatting drops blank input", () => {
  assert.deepEqual(splitLines(" alpha \n\n beta\r\n"), ["alpha", "beta"]);
  assert.equal(formatTagLines([{ tag: "AI" }, "Research", { tag: "" }]), "AI\nResearch");
});

test("Zotero write status labels distinguish offline, denied, and authorized", () => {
  assert.equal(writeStatusLabel(null), "检测中…");
  assert.equal(writeStatusLabel({ status: "offline" }), "Zotero 未运行");
  assert.equal(writeStatusLabel({ status: "connected", authorization: "denied" }), "授权被拒绝");
  assert.equal(writeStatusLabel({ status: "connected", authorization: "authorized" }), "回写已连接");
  assert.equal(writeStatusLabel({ status: "connected", authorization: "required" }), "需要授权");
});
