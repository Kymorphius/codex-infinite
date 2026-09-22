import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { installNativeTurboTurnRenderer } from "../src/native-turbo-turn-render.mjs";

const THREAD = "01a04445-8d03-7243-a4d3-181180bb626d";
const OTHER = "01a04445-8d03-7243-a4d3-181180bb626e";
const TURN = "01a04445-8d03-7243-a4d3-181180bb626f";
const NEXT = "01a04445-8d03-7243-a4d3-181180bb6270";
const BADGE = "[data-codex-control-console-turbo-turn]";

function harness({ source = "turn-start-request", receiptThread = THREAD, receiptTurn = TURN, serialized = false, withObserver = false } = {}) {
  let writes = 0, reads = 0, currentThread = THREAD;
  class Element {
    constructor(attrs = {}) {
      this.nodeType = 1; this.attrs = new Map(Object.entries(attrs)); this.children = []; this.parentElement = null;
      let css = "";
      this.style = { get cssText() { return css; }, set cssText(value) { writes += 1; css = value; } };
    }
    get textContent() { return this.text || ""; }
    set textContent(value) { this.text = value; writes += 1; }
    get title() { return this.tooltip || ""; }
    set title(value) { this.tooltip = value; writes += 1; }
    get nextElementSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1] || null; }
    getAttribute(key) { return this.attrs.get(key) ?? null; }
    setAttribute(key, value) { this.attrs.set(key, String(value)); writes += 1; }
    matches(selector) {
      return selector.split(",").some((part) => {
        const match = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(part);
        return match && this.attrs.has(match[1]) && (match[2] === undefined || this.attrs.get(match[1]) === match[2]);
      });
    }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    querySelectorAll(selector) {
      return this.children.flatMap((child) => child.nodeType === 1 ? [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)] : []);
    }
    append(...children) {
      for (const child of children) { child.remove?.(); child.parentElement = this; this.children.push(child); writes += 1; }
    }
    after(node) {
      node.remove(); node.parentElement = this.parentElement;
      this.parentElement.children.splice(this.parentElement.children.indexOf(this) + 1, 0, node); writes += 1;
    }
    remove() {
      if (!this.parentElement) return;
      this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
      this.parentElement = null; writes += 1;
    }
  }
  const root = new Element(), turn = new Element({ "data-content-search-turn-key": TURN });
  const host = new Element(), bubble = new Element({ "data-user-message-bubble": "" }), assistant = new Element();
  root.append(turn); turn.append(host, assistant); host.append(bubble);
  const documentRef = { querySelectorAll: (selector) => root.querySelectorAll(selector), createElement: () => new Element() };
  const receipts = [{ threadId: receiptThread, turnId: receiptTurn, model: "gpt-6-astra", effort: "ultra", serviceTier: "priority", contextWindow: 1000000, source }];
  const microtasks = [], hostWindow = { queueMicrotask(callback) { microtasks.push(callback); } };
  const observers = [];
  if (withObserver) hostWindow.MutationObserver = class {
    constructor(receive) { this.receive = receive; this.observations = []; this.disconnected = false; observers.push(this); }
    observe(target, options) { this.observations.push({ target, options }); this.disconnected = false; }
    disconnect() { this.disconnected = true; }
  };
  const install = serialized ? vm.runInNewContext("(" + installNativeTurboTurnRenderer.toString() + ")") : installNativeTurboTurnRenderer;
  const renderer = install({ hostWindow, documentRef, readThreadId: () => currentThread,
    getReceipts() { reads += 1; return receipts; }, formatLabel: () => "Turbo · GPT-6 Astra · Ultra · Fast · 百万" });
  const notify = (records) => { for (const subscriber of hostWindow.__codexControlConsoleMutationSubscribers) subscriber(records); };
  const flush = () => { while (microtasks.length) microtasks.shift()(); };
  return { root, turn, host, bubble, assistant, receipts, renderer, hostWindow, notify, flush, microtasks, Element, observers,
    get badge() { return turn.querySelector(BADGE); }, get writes() { return writes; }, get reads() { return reads; },
    set currentThread(value) { currentThread = value; } };
}

test("Turbo turn badge matches exact thread and turn and explains sending provenance", () => {
  const h = harness(); h.renderer.render();
  assert.equal(h.badge.textContent, "Turbo · GPT-6 Astra · Ultra · Fast · 百万");
  assert.equal(h.bubble.nextElementSibling, h.badge);
  assert.match(h.badge.title, /^Turbo 发送参数/);
  assert.match(h.badge.title, /并非上游模型回执/);
  assert.match(h.badge.title, /Jev 轮次标签/);
  for (const options of [{ receiptThread: OTHER }, { receiptTurn: NEXT }, { receiptTurn: "not-a-turn" }]) {
    const missing = harness(options); missing.renderer.render(); assert.equal(missing.badge, null);
  }
});

test("Turbo native settings have distinct provenance and the renderer is serializable", () => {
  const h = harness({ source: "native-settings", serialized: true }); h.renderer.render();
  assert.match(h.badge.title, /^轮次开始时已验证的 Turbo 原生设置/);
  h.currentThread = OTHER; h.renderer.render(); assert.equal(h.badge, null);
});

test("unchanged render retains node identity and makes no DOM writes, even beside Jev", () => {
  const h = harness(); h.renderer.render();
  const badge = h.badge, jev = new h.Element({ "data-codex-control-console-jev-turn": "" });
  h.bubble.after(jev);
  const before = h.writes;
  h.renderer.render(); h.renderer.render();
  assert.equal(h.badge, badge); assert.equal(h.writes, before);
});

test("streaming text, unrelated elements and owned mutations schedule no rendering", () => {
  const h = harness(); h.renderer.render();
  const own = h.badge, text = { nodeType: 3, parentElement: h.assistant };
  h.notify([
    { type: "characterData", target: text },
    { type: "childList", target: h.assistant, addedNodes: [text, new h.Element()] },
    { type: "childList", target: h.turn, addedNodes: [new h.Element()] },
    { type: "childList", target: h.host, addedNodes: [own], removedNodes: [own] },
    { type: "childList", target: own, addedNodes: [text] }
  ]);
  assert.equal(h.microtasks.length, 0); assert.equal(h.reads, 1);
});

test("bubble and composer remounts coalesce one render and restore badge placement", () => {
  const h = harness(); h.renderer.render(); const original = h.badge;
  h.bubble.remove(); const replacement = new h.Element({ "data-user-message-bubble": "" }); h.host.append(replacement);
  const composer = new h.Element({ "data-above-composer-conversation-id": THREAD });
  h.notify([{ type: "childList", target: h.host, addedNodes: [replacement], removedNodes: [h.bubble] }]);
  h.notify([{ type: "childList", target: h.root, addedNodes: [composer] }]);
  assert.equal(h.microtasks.length, 1); h.flush();
  assert.equal(h.badge, original); assert.equal(replacement.nextElementSibling, original);
  h.badge.remove(); h.notify([{ type: "childList", target: h.root, addedNodes: [h.turn] }]); h.flush();
  assert.ok(h.badge); assert.notEqual(h.badge, original);
});

test("recycled turn identity invalidates the old badge without requiring attribute observation", () => {
  const h = harness(); h.renderer.render(); h.turn.setAttribute("data-content-search-turn-key", NEXT);
  h.notify([{ type: "childList", target: h.assistant, addedNodes: [{ nodeType: 3 }] }]);
  assert.equal(h.microtasks.length, 1); h.flush(); assert.equal(h.badge, null);
  h.receipts[0].turnId = NEXT; h.renderer.render(); assert.ok(h.badge);
  h.turn.setAttribute("data-content-search-turn-key", TURN);
  h.notify([{ type: "attributes", target: h.turn, attributeName: "data-content-search-turn-key" }]);
  h.flush(); assert.equal(h.badge, null);
});

test("cleanup unsubscribes, removes owned badges and cancels pending microtask work", () => {
  const h = harness(); h.renderer.render();
  h.notify([{ type: "childList", target: h.root, addedNodes: [h.turn] }]);
  assert.equal(h.microtasks.length, 1); h.renderer.cleanup();
  assert.equal(h.hostWindow.__codexControlConsoleMutationSubscribers.size, 0);
  assert.equal(h.badge, null); h.flush(); h.renderer.render(); assert.equal(h.reads, 1);
});

test("standalone native owner observes mounts and yields child-list work to a shared producer", () => {
  const h = harness({ withObserver: true }); h.renderer.render();
  const observer = h.observers[0];
  assert.equal(observer.observations[0].options.childList, true);
  observer.receive([{ type: "childList", target: h.root, addedNodes: [h.turn] }]);
  h.flush(); assert.equal(h.reads, 2);
  h.hostWindow.__codexControlConsoleObserver = {};
  observer.receive([]);
  assert.equal(observer.observations.at(-1).options.childList, false);
  assert.deepEqual(observer.observations.at(-1).options.attributeFilter, ["data-content-search-turn-key", "data-above-composer-conversation-id"]);
  h.turn.setAttribute("data-content-search-turn-key", NEXT);
  observer.receive([{ type: "attributes", target: h.turn, attributeName: "data-content-search-turn-key" }]);
  h.flush(); assert.equal(h.badge, null);
  h.renderer.cleanup(); assert.equal(observer.disconnected, true);
});
