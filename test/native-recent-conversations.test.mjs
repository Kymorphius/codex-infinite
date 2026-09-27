import test from "node:test";
import assert from "node:assert/strict";
import {
  buildNativeRecentConversationMenuInjectionSource,
  NATIVE_RECENT_CONVERSATION_STYLE,
  openNativeConversationPages,
  recentNativeConversationRecords
} from "../src/native-recent-conversations.mjs";

const first = { key: "local:one", kind: "local", title: "第一个" };
const second = { key: "local:two", kind: "local", title: "第二个" };
const remote = { key: "remote:pc/three", kind: "remote", title: "第三个" };

test("top page strip exposes only the active conversation", () => {
  assert.deepEqual(openNativeConversationPages([first, second], "console"), []);
  assert.deepEqual(openNativeConversationPages([first, second], second.key), [second]);
  assert.deepEqual(openNativeConversationPages([first], "local:missing"), []);
});

test("recent conversations are newest-first, bounded, and active-first", () => {
  assert.deepEqual(recentNativeConversationRecords([first, second, remote], second.key, 2), [second, remote]);
  assert.deepEqual(recentNativeConversationRecords([first, first, second], "", 10), [second, first]);
  const many = Array.from({ length: 50 }, (_, index) => ({ key: `local:${index}` }));
  assert.equal(recentNativeConversationRecords(many).length, 40);
  assert.equal(recentNativeConversationRecords(many, "", 100).length, 40);
});

test("recent menu injection is bounded, dismissable, and route-oriented", () => {
  const source = buildNativeRecentConversationMenuInjectionSource();
  assert.match(source, /aria-haspopup/);
  assert.match(source, /m6 15 6-6 6 6/);
  assert.doesNotMatch(source, /m6 9 6 6 6-6/);
  assert.match(source, /最近会话/);
  assert.match(source, /暂无最近会话/);
  assert.match(source, /activate\(tab\.key\)/);
  assert.match(source, /openNativeConversationWindow/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /pointerdown/);
  assert.match(source, /textContent = tab\.title/);
  assert.doesNotMatch(source, /innerHTML/);
  assert.match(source, /createElementNS\("http:\/\/www\.w3\.org\/2000\/svg", "svg"\)/);
  assert.match(NATIVE_RECENT_CONVERSATION_STYLE, /height:28px/);
  assert.doesNotThrow(() => new Function(`(() => { ${source} })()`));
  assert.match(NATIVE_RECENT_CONVERSATION_STYLE, /max-height/);
  assert.match(NATIVE_RECENT_CONVERSATION_STYLE, /bottom:34px/);
  assert.match(NATIVE_RECENT_CONVERSATION_STYLE, /data-active/);
});
