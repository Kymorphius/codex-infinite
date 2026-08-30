import test from "node:test";
import assert from "node:assert/strict";
import { boundedInteger, collectionTreeOrder, escapeLikeTerm, mapItemRow, publicReadError } from "../src/zotero-read-contract.mjs";

test("Zotero read inputs stay bounded and LIKE metacharacters stay escaped", () => {
  assert.equal(boundedInteger(999, 24, 1, 100), 100);
  assert.equal(boundedInteger("bad", 24, 1, 100), 24);
  assert.equal(escapeLikeTerm("a%b_c\\d"), "a\\%b\\_c\\\\d");
});

test("Zotero collection mapping remains hierarchical and item rows remain normalized", () => {
  assert.deepEqual(collectionTreeOrder([
    { id: 2, parentCollectionId: 1, name: "Child" },
    { id: 1, parentCollectionId: null, name: "Root" }
  ]).map(({ id, depth }) => [id, depth]), [[1, 0], [2, 1]]);
  const item = mapItemRow({ itemId: 7, id: 7, title: null, itemType: "book", date: "2024-05" });
  assert.equal(item.title, "未命名条目");
  assert.equal(item.year, 2024);
  assert.deepEqual(item.tags, []);
});

test("Zotero public read errors never expose raw paths or messages", () => {
  const message = publicReadError(Object.assign(new Error("open /secret/library.sqlite failed"), { code: "SQLITE_CANTOPEN" }));
  assert.match(message, /Zotero/);
  assert.doesNotMatch(message, /secret|sqlite/i);
});
