import test from "node:test";
import assert from "node:assert/strict";
import {
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
  assert.match(source, /\['Projects', 40\]/);
  assert.match(source, /\['待整理', 50\]/);
  assert.match(source, /\['云工作', 70\]/);
  assert.match(source, /\['项目（聊天）', 75\]/);
  assert.match(source, /\['Recents', 80\]/);
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
  assert.match(source, /item\.setAttribute\(ROW_CLASSIFICATION_MARKER, kind\)/);
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
  assert.ok(source.includes("['Pinned', 1]"));
  assert.ok(source.includes("['置顶', 1]"));
});
