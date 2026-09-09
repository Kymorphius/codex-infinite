import assert from "node:assert/strict";
import test from "node:test";

import {
  installNativeConversationTabWheelPreferences,
  nativeConversationTabWheelOffset,
  normalizeNativeConversationTabWheelDirection
} from "../src/native-conversation-tab-preferences.mjs";

test("wheel direction normalization preserves the existing default", () => {
  assert.equal(normalizeNativeConversationTabWheelDirection(), "standard");
  assert.equal(normalizeNativeConversationTabWheelDirection("unknown"), "standard");
  assert.equal(normalizeNativeConversationTabWheelDirection("reversed"), "reversed");
});

test("reversed wheel direction flips the adjacent-tab offset", () => {
  assert.equal(nativeConversationTabWheelOffset(-40, "standard"), 1);
  assert.equal(nativeConversationTabWheelOffset(40, "standard"), -1);
  assert.equal(nativeConversationTabWheelOffset(-40, "reversed"), -1);
  assert.equal(nativeConversationTabWheelOffset(40, "reversed"), 1);
  assert.equal(nativeConversationTabWheelOffset(0, "reversed"), 0);
});

test("injected preference control is visible, persisted, and accessible", () => {
  const source = installNativeConversationTabWheelPreferences.toString();
  assert.match(source, /标签设置/);
  assert.match(source, /滚动方向/);
  assert.match(source, /标准（上滚向右）/);
  assert.match(source, /反向（上滚向左）/);
  assert.match(source, /menuitemradio/);
  assert.match(source, /state\.wheelDirection = normalizeNativeConversationTabWheelDirection/);
  assert.match(source, /persist\(\)/);
  assert.match(source, /nativeConversationTabWheelOffset\(accumulator, state\.wheelDirection\)/);
});
