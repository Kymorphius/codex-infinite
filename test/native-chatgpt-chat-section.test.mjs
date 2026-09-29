import test from "node:test";
import assert from "node:assert/strict";
import { NATIVE_SECTION_ORDER, NATIVE_SIDEBAR_ORDER } from "../src/native-sidebar-order.mjs";
import {
  nativeSidebarFlexItem,
  buildNativeChatgptChatSectionInjectionScript,
  classifyNativeChatgptRecentTarget,
  nativeChatgptConversationTrigger
} from "../src/native-chatgpt-chat-section.mjs";

test("recent ChatGPT targets distinguish unassigned, project, and cloud work rows", () => {
  assert.equal(classifyNativeChatgptRecentTarget({ source: "chatgpt", projectId: null }), "ordinary-chat");
  assert.equal(classifyNativeChatgptRecentTarget({ source: "chatgpt", projectId: "g-p-example" }), "project-chat");
  assert.equal(classifyNativeChatgptRecentTarget({ source: "codex", conversation: { conversation_origin: "tpp" } }), "cloud-work");
  assert.equal(classifyNativeChatgptRecentTarget(undefined), "ordinary-chat");
});

test("projected ChatGPT rows invoke their direct native interactive trigger", () => {
  const trigger = { click() {} };
  const row = {
    matches: () => false,
    querySelector(selector) {
      assert.equal(selector, ':scope > a,:scope > button,:scope > [role="button"]');
      return trigger;
    }
  };
  assert.equal(nativeChatgptConversationTrigger(row), trigger);
  const directRow = { matches: () => true };
  assert.equal(nativeChatgptConversationTrigger(directRow), directRow);
  assert.equal(nativeChatgptConversationTrigger(null), null);
});

test("ChatGPT chat section projects cloud work into a separate top-level section", () => {
  const source = buildNativeChatgptChatSectionInjectionScript();
  assert.match(source, /sidebar-section-heading="Recents"/);
  assert.match(source, /__codexControlConsoleApplyChatSection\?\.\(\)/);
  assert.match(source, /characterData: true/);
  assert.match(source, /label\(section, '聊天'\)/);
  assert.match(source, /key === 'Projects'.*label\(section, '项目'\)/s);
  assert.match(source, /key === '项目（聊天）'.*label\(section, '聊天 项目'\)/s);
  assert.ok(source.includes(JSON.stringify(NATIVE_SECTION_ORDER)));
  assert.match(source, /\["Projects",30\]/);
  assert.match(source, /\["待整理",43\]/);
  assert.match(source, /\["云工作",52\]/);
  assert.match(source, /\["项目（聊天）",51\]/);
  assert.match(source, /\["Recents",50\]/);
  assert.match(source, /data-codex-control-console-section-order/);
  assert.match(source, /wrapper\.style\.order/);
  assert.match(source, /data-sidebar-chatgpt-conversation-key/);
  assert.match(source, /chatGptSource\?\.chatTargets/);
  assert.match(source, /targetByKey/);
  assert.match(source, /kind === 'ordinary-chat'/);
  assert.match(source, /kind === 'cloud-work'/);
  assert.match(source, /data-codex-control-console-chat-classification/);
  assert.match(source, /data-codex-control-console-chat-classification-style/);
  assert.match(source, /:not\(\[' \+ ROW_CLASSIFICATION_MARKER \+ '\]\) \{ display: none !important; \}/);
  assert.match(source, /item\.getAttribute\(ROW_CLASSIFICATION_MARKER\) !== kind/);
  assert.match(source, /data-codex-control-console-ordinary-chat-list/);
  assert.match(source, /data-codex-control-console-ordinary-chat-row/);
  assert.match(source, /data-codex-control-console-chat-source-bootstrapped/);
  assert.match(source, /event\.stopImmediatePropagation\(\)/);
  assert.match(source, /toggle\.addEventListener\('click', handler, true\)/);
  assert.match(source, /renderOrdinaryChats\(section, renderedOrdinaryChats\)/);
  assert.match(source, /\[role="list"\]:not\(\[' \+ CHAT_PROXY_LIST/);
  assert.doesNotMatch(source, /fetchNextConversationPage\s*\(/);
  assert.match(source, /endsWith\('工作'\)/);
  assert.match(source, /云工作/);
  assert.match(source, /data-codex-control-console-cloud-work-list/);
  assert.match(source, /data-codex-control-console-cloud-work-row/);
  assert.match(source, /codex-control-console\.cloud-work\.v1/);
  assert.match(source, /data-codex-control-console-listitem-display/);
  assert.match(source, /const hiddenItems = new Set\(\)/);
  assert.match(source, /if \(item\.style\.display !== 'none'\) item\.style\.display = 'none'/);
  assert.match(source, /toggle\.getAttribute\('aria-expanded'\) !== expanded/);
  assert.match(source, /row\.closest\('\[role="listitem"\]'\)/);
  assert.match(source, /item\.style\.display = 'none'/);
  assert.match(source, /openConversation/);
  assert.match(source, /chatgpt:conversation:\(\[0-9a-f-\]\{36\}\)/);
  assert.match(source, /navigate-to-route/);
  assert.match(source, /path: '\/c\/'/);
  assert.match(source, /conversationTrigger\(nativeRow\)/);
  assert.match(source, /if \(nativeTrigger\) nativeTrigger\.click\(\)/);
  assert.doesNotMatch(source, /if \(nativeRow\) nativeRow\.click\(\)/);
  assert.match(source, /else window\.postMessage/);
  assert.match(source, /__codexControlConsoleConversationTabs\?\.openChatgpt/);
  assert.match(source, /addChatTab = false/);
  assert.match(source, /CHAT_PROXY_ROW\) \|\| '', row\.getAttribute\('aria-label'\), true/);
  assert.doesNotMatch(source, /wasCollapsed/);
  assert.doesNotMatch(source, /setTimeout\(open/);
  assert.match(source, /item\.style\.display = 'none'/);
  assert.match(source, /projectLoadingSpinner/);
  assert.match(source, /className\.includes\('animate-spin'\)/);
  assert.match(source, /data-codex-control-console-loading-item-style/);
  assert.match(source, /position:absolute;top:4px;inset-inline-start:64px/);
  assert.match(source, /MutationObserver/);
  assert.match(source, /requestAnimationFrame/);
  assert.match(source, /data-codex-control-console-chat-title/);
  assert.match(source, /data-codex-control-console-non-chat-display/);
  assert.match(source, /LEGACY_HIDDEN_MARKER/);
  assert.doesNotMatch(source, /row\.style\.display = 'none'/);
  assert.doesNotMatch(source, /appendChild\(conversation/);
  assert.doesNotMatch(source, /insertBefore\(conversation/);
  assert.doesNotMatch(source, /replaceWith\(conversation/);
});

test('native pinned section precedes search and other sidebar sections', () => {
  const source = buildNativeChatgptChatSectionInjectionScript();
  assert.ok(source.includes('["Pinned",20]'));
  assert.ok(source.includes('["置顶",20]'));
});

test("section order lands on the sidebar flex item even when ChatGPT adds a wrapper", () => {
  const node = (display, scroll = false) => ({ display, matches: selector => scroll && selector === "[data-app-action-sidebar-scroll]" });
  const scroller = node("flex", true), contents = node("contents"), dropTarget = node("block"), container = node("block"), section = node("block");
  contents.parentElement = scroller; dropTarget.parentElement = contents; container.parentElement = dropTarget; section.parentElement = container;
  const style = value => ({ display: value.display });
  assert.equal(nativeSidebarFlexItem(section, style), dropTarget, "Recents is wrapped by a drop target");
  const direct = node("block"); direct.parentElement = scroller; const plain = node("block"); plain.parentElement = direct;
  assert.equal(nativeSidebarFlexItem(plain, style), direct);
  assert.equal(nativeSidebarFlexItem(null, style), null);
});

test("sidebar groups run search, attention, projects, user sections, then ChatGPT", () => {
  const o = NATIVE_SIDEBAR_ORDER;
  const sequence = [o.projectSearch, o.sentMessageSearch, o.pinned, o.review, o.active, o.codex, o.history, o.projects, o.newProjects, o.remote,
    ...NATIVE_SECTION_ORDER.filter(([name]) => ["现在", "等待", "本周", "待整理", "临时"].includes(name)).map(([, value]) => value), o.userSection, o.chats, o.chatProjects, o.cloud];
  assert.deepEqual(sequence, [...sequence].sort((a, b) => a - b));
  assert.equal(new Set(sequence).size, sequence.length);
});

test("sidebar flex wrapper is resolved once per section, without re-reading computed styles", () => {
  // Regression: apply() walked ancestors reading computed display on every 1.2s sync; with the
  // terminal keeping styles dirty each read forced a full ~100ms style recalc.
  const scroll = { matches: selector => selector === "[data-app-action-sidebar-scroll]" };
  const wrapper = { parentElement: scroll, matches: () => false, isConnected: true, contains: () => true };
  const inner = { parentElement: wrapper, matches: () => false }, section = { parentElement: inner };
  let reads = 0; const style = () => { reads++; return { display: "block" }; };
  const cache = new WeakMap();
  assert.equal(nativeSidebarFlexItem(section, style, cache), wrapper);
  const first = reads; assert.ok(first > 0, "the first resolve walks and reads styles");
  for (let i = 0; i < 5; i++) assert.equal(nativeSidebarFlexItem(section, style, cache), wrapper);
  assert.equal(reads, first, "cached wrapper needs no style reads");
  wrapper.isConnected = false; nativeSidebarFlexItem(section, style, cache);
  assert.ok(reads >= first, "a replaced wrapper is resolved again");
});
