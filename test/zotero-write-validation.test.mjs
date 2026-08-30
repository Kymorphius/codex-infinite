import test from "node:test";
import assert from "node:assert/strict";
import { collectionKey, itemKey, validateCreateInput, validateUpdateInput } from "../src/zotero-write-validation.mjs";
import { pickEditableData, writeError } from "../src/zotero-local-contract.mjs";

test("Zotero write validation keeps exact allowlists and complete-list intent", () => {
  assert.deepEqual(validateUpdateInput({
    version: 4,
    fields: { title: " Updated " },
    creators: [], tags: [], collections: [],
    completeLists: ["creators", "tags", "collections", "tags"]
  }), { version: 4, fields: { title: "Updated" }, creators: [], tags: [], collections: [], completeLists: ["creators", "tags", "collections"] });
  assert.throws(() => validateCreateInput({ itemType: "attachment", fields: {}, creators: [], tags: [], collections: [] }), /只支持/);
  assert.throws(() => validateCreateInput({ itemType: "book", fields: { path: "/private" }, creators: [], tags: [], collections: [] }), /不支持/);
});

test("Zotero identifiers and status mapping fail closed without exposing bodies", () => {
  assert.equal(itemKey("ITEM_123"), "ITEM_123");
  assert.equal(collectionKey("COL-123"), "COL-123");
  assert.throws(() => itemKey("../secret"), /标识无效/);
  assert.deepEqual(writeError(412), {
    status: "conflict", authorization: undefined,
    message: "这条文献已被其他位置更新，请重新加载后再提交。", httpStatus: 412
  });
});

test("editable Zotero projection returns only supported metadata", () => {
  const item = pickEditableData({ key: "ITEM1", itemType: "book", version: 3, title: "One", arbitraryPath: "/private", tags: ["safe"] }, "fallback", 1);
  assert.equal(item.key, "ITEM1");
  assert.equal(item.fields.title, "One");
  assert.equal(Object.hasOwn(item.fields, "arbitraryPath"), false);
  assert.deepEqual(item.tags, [{ tag: "safe" }]);
});
