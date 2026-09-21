import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { buildNativeConversationTabsInjectionSource } from "../src/native-conversation-tabs.mjs";
import { buildNativeTurnAnnotationsScript } from "../src/native-turn-annotations.mjs";
import { buildNativeNewProjectsInjectionScript } from "../src/native-new-projects.mjs";
import { buildNativeAttentionConversationsInjectionScript } from "../src/native-attention-conversations.mjs";
import { nativeOwnerPollDelay } from "../src/native-owner-injector.mjs";
import { installNativeJevMutationRefresh } from "../src/native-jev-mutation-refresh.mjs";
import { buildNativeJevRoutingInjectionScript } from "../src/native-jev-routing.mjs";
import { installNativeProjectSearch } from "../src/native-project-search.mjs";
import { installUnifiedSidebar } from "../src/native-unified-sidebar.mjs";
import { buildNativeTurboInjectionScript } from "../src/native-turbo-injection.mjs";
import { buildNativeLongConversationInjectionScript, longConversationColdTurnIndexes } from "../src/native-long-conversation.mjs";

test("native conversation tabs coalesce broad mutation layout work", () => {
  const source = buildNativeConversationTabsInjectionSource();
  assert.match(source, /function scheduleSync\(urgent = false\)/);
  assert.match(source, /const interval = urgent \? 0 : 320/);
  assert.match(source, /scheduleSync\(routeChanged\(records\)\)/);
  assert.doesNotMatch(source, /position\(\); scheduleSync\(\)/);
  assert.match(source, /function syncNativeTitleTakeover\(workspace, workspaceRect, force = false\)/);
  assert.match(source, /now - topControlsScannedAt < 1000/);
  assert.match(source, /position\(urgent\)/);
  assert.match(source, /filter\(\(\{ bounds \}\) => bounds\.width > 0 && bounds\.height > 0 && bounds\.top < 42\)\s*\.map\(\(record\) => \(\{ \.\.\.record, style: getComputedStyle\(record\.button\) \}\)\)/);
});

test("turn annotations skip repeated bridge snapshots and coalesce layout reads", () => {
  const source = buildNativeTurnAnnotationsScript();
  assert.match(source, /if \(next === presentationSuppressed\) return/);
  assert.match(source, /acceptedSignature/);
  assert.match(source, /schedule\(200\)/);
  assert.match(source, /function schedulePaint\(\)/);
  assert.match(source, /paintFrame = requestFrame/);
  assert.match(source, /outputCard\?\.isConnected/);
  assert.match(source, /const timer = setTimeout\(\(\) => schedule\(\), 1000\)/);
  assert.doesNotMatch(source, /setInterval\(refresh, 1000\)/);
  assert.match(source, /const setHidden = \(node, value\) => \{ if \(node\.hidden !== value\) node\.hidden = value; \}/);
  assert.match(source, /now - lastCardScanAt < 1000/);
  assert.match(source, /lastCardScanAt = 0/);
});

test("native sidebar projections do not observe their own render mutations", () => {
  for (const source of [buildNativeNewProjectsInjectionScript(), buildNativeAttentionConversationsInjectionScript()]) {
    assert.match(source, /function isOwnMutation\(record\)/);
    assert.match(source, /new MutationObserver\(records => \{ if \(!records\.every\(isOwnMutation\)\) schedule\(\); \}\)/);
  }
  const newProjects = buildNativeNewProjectsInjectionScript();
  assert.match(newProjects, /function scheduleExpiry\(\)/);
  assert.doesNotMatch(newProjects, /setInterval\(schedule, 1000\)/);
});

test("Jev mutation refresh ignores its own render but detects native remounts", () => {
  let installs = 0;
  const subscribers = new Set();
  const own = { nodeType: 1, matches: selector => selector.includes("data-codex-control-console-native-jev"), closest: selector => selector.includes("data-codex-control-console-native-jev") ? own : null, querySelector: () => null };
  const native = { nodeType: 1, matches: selector => selector.includes("data-above-composer-conversation-id"), closest: () => null, querySelector: () => null };
  const ordinary = { nodeType: 1, matches: () => false, closest: () => null, querySelector: () => null };
  const hostWindow = { __codexControlConsoleMutationSubscribers: subscribers, requestAnimationFrame(callback) { callback(); return 1; }, cancelAnimationFrame() {} };
  const cleanup = installNativeJevMutationRefresh({ install: () => { installs += 1; }, findModelChangeNotices: () => [], hostWindow });
  const receive = [...subscribers][0];
  receive([{ type: "childList", target: own, addedNodes: [], removedNodes: [] }]);
  receive([{ type: "childList", target: ordinary, addedNodes: [ordinary], removedNodes: [] }]);
  assert.equal(installs, 0);
  receive([{ type: "childList", target: ordinary, addedNodes: [native], removedNodes: [] }]);
  assert.equal(installs, 1);
  cleanup();
});

test("Jev rendering is idempotent after state and placement settle", () => {
  const source = buildNativeJevRoutingInjectionScript();
  assert.match(source, /data-codex-control-console-jev-render-signature/);
  assert.match(source, /data-codex-control-console-jev-native-render-signature/);
  assert.match(source, /if \(anchor\.nextElementSibling !== current\) anchor\.after\(current\)/);
  assert.match(source, /if \(choice && current\.nextElementSibling !== choice\) current\.after\(choice\)/);
});

test("persistent native controls skip identical idle-state DOM writes", () => {
  assert.match(installNativeProjectSearch.toString(), /if \(root\.className !== rootClassName\) root\.className = rootClassName/);
  assert.match(installUnifiedSidebar.toString(), /if \(toggle\.getAttribute\('aria-pressed'\) !== pressed\) toggle\.setAttribute\('aria-pressed', pressed\)/);
  assert.match(installUnifiedSidebar.toString(), /新聊天\|新对话\|New chat/);
  assert.match(installUnifiedSidebar.toString(), /if \(placementSignature !== nextPlacement\)/);
  const turbo = buildNativeTurboInjectionScript();
  assert.match(turbo, /data-codex-control-console-turbo-render-signature/);
  assert.match(turbo, /if \(!row\.hasAttribute\('data-codex-control-console-interactive-header'\)\)/);
});

test("primary native bridge retry delay backs off and remains capped", () => {
  assert.equal(nativeOwnerPollDelay(1200, 0, 30000), 1200);
  assert.equal(nativeOwnerPollDelay(1200, 1, 30000), 2400);
  assert.equal(nativeOwnerPollDelay(1200, 4, 30000), 19200);
  assert.equal(nativeOwnerPollDelay(1200, 8, 30000), 30000);
});

test("long conversations keep the newest turns eager without removing history", () => {
  assert.deepEqual(longConversationColdTurnIndexes(12), []);
  assert.deepEqual(longConversationColdTurnIndexes(20), [0, 1, 2, 3, 4, 5, 6, 7]);
  const source = buildNativeLongConversationInjectionScript();
  assert.match(source, /content-visibility:auto/);
  assert.match(source, /contain-intrinsic-size:auto 560px/);
  assert.match(source, /turns\.length - eager/);
  assert.match(source, /records\.some\(relevantMutation\)/);
  assert.doesNotMatch(source, /setInterval/);
  assert.doesNotMatch(source, /\.remove\(\).*data-turn-key/);
});

test("long conversation controller cools only old turns and advances the boundary after append", () => {
  class Element {
    constructor(kind = "turn") { this.nodeType = 1; this.kind = kind; this.attrs = new Map(); this.children = []; this.isConnected = true; }
    matches(selector) { return (selector.includes("data-turn-key") && this.kind === "turn") || (selector.includes("data-thread-user-message-navigation-content") && this.kind === "root"); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    querySelectorAll(selector) {
      if (selector.includes("data-turn-key")) return this.kind === "root" ? this.children : [];
      if (selector.includes("data-ccc-long-conversation-cold-turn")) return this.children.filter((child) => child.hasAttribute("data-ccc-long-conversation-cold-turn"));
      return [];
    }
    setAttribute(name, value) { this.attrs.set(name, value); }
    hasAttribute(name) { return this.attrs.has(name); }
    removeAttribute(name) { this.attrs.delete(name); }
    append(...children) { this.children.push(...children); }
    remove() { this.isConnected = false; }
  }
  const root = new Element("root");
  root.append(...Array.from({ length: 20 }, () => new Element()));
  const head = new Element("head"), documentElement = new Element("document"), idle = [];
  let receiveMutation;
  const document = {
    head, documentElement,
    getElementById: () => null,
    createElement: () => new Element("style"),
    querySelector: (selector) => selector.includes("data-thread-user-message-navigation-content") ? root : null,
    querySelectorAll: (selector) => root.querySelectorAll(selector)
  };
  const window = {};
  const context = vm.createContext({
    window, document,
    MutationObserver: class { constructor(callback) { receiveMutation = callback; } observe() {} disconnect() {} },
    requestIdleCallback(callback) { idle.push(callback); return idle.length; },
    cancelIdleCallback() {}, clearTimeout() {}, setTimeout(callback) { idle.push(callback); return idle.length; }
  });
  vm.runInContext(buildNativeLongConversationInjectionScript(), context);
  assert.equal(root.children.filter((turn) => turn.hasAttribute("data-ccc-long-conversation-cold-turn")).length, 8);
  root.children.push(new Element());
  receiveMutation([{ type: "childList", addedNodes: [root.children.at(-1)], removedNodes: [] }]);
  idle.shift()();
  assert.equal(root.children.filter((turn) => turn.hasAttribute("data-ccc-long-conversation-cold-turn")).length, 9);
  assert.equal(root.children.at(-1).hasAttribute("data-ccc-long-conversation-cold-turn"), false);
  assert.equal(root.children.length, 21);
});
