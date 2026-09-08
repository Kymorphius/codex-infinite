import test from "node:test";
import assert from "node:assert/strict";
import { reorderNativeConversationTabs } from "../src/native-conversation-tab-drag.mjs";

const tabs = [
  { key: "local:one", title: "一" },
  { key: "local:two", title: "二" },
  { key: "remote:device/three", title: "三" }
];

test("conversation tab drag ordering supports before and after placement", () => {
  assert.deepEqual(
    reorderNativeConversationTabs(tabs, tabs[0].key, tabs[2].key, true).map((tab) => tab.key),
    [tabs[1].key, tabs[2].key, tabs[0].key]
  );
  assert.deepEqual(
    reorderNativeConversationTabs(tabs, tabs[2].key, tabs[0].key, false).map((tab) => tab.key),
    [tabs[2].key, tabs[0].key, tabs[1].key]
  );
});

test("conversation tab drag ordering rejects Console, missing, and self targets", () => {
  assert.deepEqual(reorderNativeConversationTabs(tabs, "console", tabs[0].key), tabs);
  assert.deepEqual(reorderNativeConversationTabs(tabs, tabs[0].key, "missing"), tabs);
  assert.deepEqual(reorderNativeConversationTabs(tabs, tabs[0].key, tabs[0].key), tabs);
});
