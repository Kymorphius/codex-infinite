import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { buildNativeConversationWindowInjectionSource } from "../src/native-conversation-window.mjs";
import { buildNativeConversationTabsInjectionSource } from "../src/native-conversation-tabs.mjs";
import { buildNativeRecentConversationMenuInjectionSource } from "../src/native-recent-conversations.mjs";
import {
  normalizeRecentSentSnapshot,
  buildNativeRecentSentMenuInjectionSource,
  buildNativeRecentSentSnapshotScript
} from "../src/native-recent-sent-conversations.mjs";

const id = (number) => `00000000-0000-0000-0000-${String(number).padStart(12, "0")}`;
const record = (number, minute = number) => ({ kind: "local", id: id(number), title: `会话 ${number}`, lastUserMessageAt: `2026-09-22T10:${String(minute).padStart(2, "0")}:00.000Z` });
const plain = (value) => JSON.parse(JSON.stringify(value));

class Events {
  listeners = new Map();
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  dispatch(type, values = {}) {
    const event = { target: this, preventDefault() {}, stopPropagation() {}, ...values };
    for (const callback of this.listeners.get(type) || []) callback(event);
    return event;
  }
  listenerCount(type) { return this.listeners.get(type)?.size || 0; }
}

class Element extends Events {
  constructor(documentRef, tag) {
    super();
    this.document = documentRef; this.tagName = tag; this.children = []; this.dataset = {};
    this.attrs = new Map(); this.hidden = false; this.replaceCalls = 0; this.ownText = "";
  }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.get(name) ?? null; }
  removeAttribute(name) { this.attrs.delete(name); }
  append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
  replaceChildren(...children) {
    this.replaceCalls += 1;
    this.children.forEach((child) => { child.parent = null; });
    this.children = []; this.append(...children);
  }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); this.parent = null; }
  contains(target) { return target === this || this.children.some((child) => child.contains(target)); }
  focus() { this.document.activeElement = this; }
  get textContent() { return this.ownText + this.children.map((child) => child.textContent).join(""); }
  set textContent(value) { this.ownText = String(value); this.children = []; }
  querySelector(selector) {
    const match = /^\[role="([^"]+)"\]$/.exec(selector);
    for (const child of this.children) {
      if (match && child.getAttribute("role") === match[1]) return child;
      const nested = child.querySelector(selector);
      if (nested) return nested;
    }
    return null;
  }
}

function fixture(snapshot = { items: [] }) {
  const document = new Events();
  document.createElement = (tag) => new Element(document, tag);
  const root = document.createElement("nav"), selected = [], opened = [], activated = [];
  const state = { tabs: [record(1)], activeKey: `local:${id(1)}` };
  const window = { __codexControlConsoleRecentSentSnapshot: normalizeRecentSentSnapshot(snapshot) };
  const context = vm.createContext({ window });
  const api = vm.runInContext([
    buildNativeConversationWindowInjectionSource(), buildNativeRecentConversationMenuInjectionSource(),
    buildNativeRecentSentMenuInjectionSource(), "({ installNativeRecentConversationMenu, installNativeRecentSentMenu })"
  ].join("\n"), context);
  const options = {
    documentRef: document, root, state, keyFor: (tab) => `${tab.kind}:${tab.id}`,
    openWindow: async (tab, request) => { opened.push({ tab, request }); return true; }
  };
  const recent = api.installNativeRecentConversationMenu({ ...options, activate: (key) => activated.push(key) });
  const sent = api.installNativeRecentSentMenu({ ...options, openLocal: (tab) => selected.push(tab), readSnapshot: () => window.__codexControlConsoleRecentSentSnapshot });
  let updates = 0;
  window.__codexControlConsoleConversationTabs = { updateRecentSent() { updates += 1; sent.render(); } };
  const host = root.children[1], trigger = host.children[0], menu = host.children[1];
  return {
    document, root, state, window, recent, sent, trigger, menu, selected, opened, activated,
    update: (input) => vm.runInContext(buildNativeRecentSentSnapshotScript(input), context),
    updates: () => updates
  };
}

test("recent sent normalization sorts actual user time, deduplicates, bounds and strips private metadata", () => {
  const upperId = "ABCDEFAB-0000-0000-0000-000000000001";
  const normalized = normalizeRecentSentSnapshot({ items: [
    { ...record(1), updatedAt: "2099-01-01", prompt: "private", sourceFile: "/private/session" },
    record(2), { ...record(3), kind: "remote" }, { ...record(4), kind: "chatgpt" },
    { ...record(5), id: "not-a-thread" }, { ...record(6), lastUserMessageAt: "invalid" },
    { ...record(7), id: upperId, title: "old title" },
    { ...record(8), id: upperId.toLowerCase(), title: "new\u0000title" }
  ] });
  assert.deepEqual(normalized.items.map((item) => item.id), [upperId.toLowerCase(), id(2), id(1)]);
  assert.equal(normalized.items[0].title, "new title");
  assert.deepEqual(Object.keys(normalized.items[2]).sort(), ["id", "kind", "lastUserMessageAt", "status", "title"]);
  assert.equal(normalized.items[2].status, "unknown");
  assert.deepEqual(normalizeRecentSentSnapshot({ items: [{ ...record(1), status: "active" }, { ...record(2), status: "forged" }] }).items.map((item) => item.status), ["unknown", "active"]);
  assert.deepEqual(normalizeRecentSentSnapshot(null), { items: [], loading: false, stale: false });
  const bounded = normalizeRecentSentSnapshot({ items: Array.from({ length: 50 }, (_, index) => record(index + 1)) });
  assert.equal(bounded.items.length, 40);
  assert.equal(bounded.items[0].id, id(50));
  assert.equal(bounded.items.at(-1).id, id(11));
});

test("both recent menus append forty entries in pages only while opened", () => {
  const items = Array.from({ length: 40 }, (_, index) => record(index + 1));
  const f = fixture({ items });
  f.state.tabs = items;
  assert.equal(f.menu.replaceCalls, 0);
  const openedMenu = f.root.children[0].children[1];
  openedMenu.clientHeight = 500; openedMenu.scrollHeight = 900;
  f.root.children[0].children[0].dispatch("click");
  assert.equal(openedMenu.children.length, 12);
  openedMenu.scrollTop = 500; openedMenu.dispatch("scroll");
  assert.equal(openedMenu.children.length, 24);
  openedMenu.scrollTop = 1000; openedMenu.scrollHeight = 1400; openedMenu.dispatch("scroll");
  assert.equal(openedMenu.children.length, 36);
  openedMenu.scrollTop = 1500; openedMenu.scrollHeight = 1900; openedMenu.dispatch("scroll");
  assert.equal(openedMenu.children.length, 40);
  f.menu.clientHeight = 500; f.menu.scrollHeight = 900;
  f.trigger.dispatch("click");
  assert.equal(f.menu.children.length, 12);
  const firstRow = f.menu.children[0];
  f.menu.scrollTop = 500; f.menu.dispatch("scroll");
  assert.equal(f.menu.children.length, 24);
  assert.equal(f.menu.children[0], firstRow);
  assert.equal(f.menu.replaceCalls, 1);
  f.menu.scrollTop = 1000; f.menu.scrollHeight = 1400; f.menu.dispatch("scroll");
  f.menu.scrollTop = 1500; f.menu.scrollHeight = 1900; f.menu.dispatch("scroll");
  assert.equal(f.menu.children.length, 40);
  assert.equal(f.menu.children[0].children[0].dataset.recentKey, `local:${id(40)}`);
  f.sent.render();
  assert.equal(f.menu.children.length, 40);
  assert.equal(f.menu.replaceCalls, 1);
});

test("recent menu fills a tall viewport without requiring an impossible scroll", () => {
  const f = fixture({ items: Array.from({ length: 30 }, (_, index) => record(index + 1)) });
  f.menu.clientHeight = 500; f.menu.scrollHeight = 300;
  f.trigger.dispatch("click");
  assert.equal(f.menu.children.length, 30);
});

test("recent sent is adjacent to recent opened and does not promote the active conversation", () => {
  const f = fixture({ items: [record(1), record(2)] });
  assert.deepEqual(f.root.children.map((host) => host.children[0].getAttribute("aria-label")), ["最近会话", "最近发送"]);
  assert.match(f.trigger.title, /本机 Codex/);
  assert.equal(f.menu.replaceCalls, 0);
  f.trigger.dispatch("click");
  assert.equal(f.menu.hidden, false);
  assert.equal(f.trigger.getAttribute("aria-expanded"), "true");
  assert.deepEqual(f.menu.children.map((row) => row.children[0].dataset.recentKey), [`local:${id(2)}`, `local:${id(1)}`]);
  assert.equal(f.menu.children[1].dataset.active, "true");
  assert.doesNotMatch(f.menu.children[0].textContent, /发送于/);
  assert.match(f.menu.children[0].textContent, /2026\/9\/22/);
  assert.equal(f.document.activeElement, f.menu.children[0].children[0]);
  const openedHost = f.root.children[0];
  openedHost.children[0].dispatch("click");
  openedHost.children[1].children[0].children[0].dispatch("click");
  assert.deepEqual(f.activated, [`local:${id(1)}`]);
});

test("recent sent rows reuse a rendered native status SVG and fall back only to known task status", () => {
  const f = fixture({ items: [{ ...record(1), status: "active" }, { ...record(2), status: "completed" }] });
  const svg = f.document.createElement("svg");
  svg.outerHTML = '<svg data-native-status="running"></svg>';
  svg.cloneNode = () => { const copy = f.document.createElement("svg"); copy.outerHTML = svg.outerHTML; return copy; };
  const rail = { classList: { contains: (name) => ["absolute", "end-0", "group-hover:hidden"].includes(name) }, children: [svg], querySelector: (selector) => selector === "svg" ? svg : selector.includes("animate-spin") ? {} : null };
  f.document.querySelector = (selector) => selector.includes(id(1)) ? { querySelectorAll: () => [rail] } : null;
  f.trigger.dispatch("click");
  const completed = f.menu.children[0].statusDot, active = f.menu.children[1].statusDot;
  assert.equal(completed.dataset.status, "completed");
  assert.equal(completed.dataset.statusSource, "fallback");
  assert.equal(active.dataset.statusSource, "native");
  assert.equal(active.dataset.nativeRunning, "true");
  assert.equal(active.children[0].outerHTML, svg.outerHTML);
  f.sent.close(); f.document.querySelector = () => null;
  f.trigger.dispatch("click");
  assert.equal(active.dataset.statusSource, "fallback");
  assert.equal(active.dataset.status, "active");
});

test("select and new-window actions work for sent conversations absent from opened history", async () => {
  const f = fixture({ items: [record(2)] });
  f.trigger.dispatch("click");
  const row = f.menu.children[0], windowButton = row.children[1];
  windowButton.dispatch("click");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.opened.length, 1);
  assert.equal(f.opened[0].tab.id, id(2));
  assert.deepEqual(plain(f.opened[0].request), { type: "open-in-new-window", path: `/local/${id(2)}` });
  assert.equal(windowButton.getAttribute("data-window-opened"), "");
  row.children[0].dispatch("click");
  assert.equal(f.selected.length, 1);
  assert.equal(f.selected[0].id, id(2));
  assert.equal(f.menu.hidden, true);
  assert.deepEqual(f.state.tabs.map((tab) => tab.id), [id(1)], "snapshot selection does not silently rewrite opened history");
});

test("loading, empty and stale snapshots have explicit non-destructive display states", () => {
  const f = fixture({ items: [], loading: true });
  f.trigger.dispatch("click");
  assert.match(f.menu.textContent, /正在索引发送时间/);
  f.update({ items: [] });
  assert.match(f.menu.textContent, /暂无发过消息的本机会话/);
  f.update({ items: [record(2)], stale: true });
  assert.match(f.menu.textContent, /部分发送时间暂未刷新，保留已知记录/);
  assert.equal(f.menu.children[0].getAttribute("role"), "status");
  assert.equal(f.menu.children[1].children[0].dataset.recentKey, `local:${id(2)}`);
  assert.equal(f.menu.hidden, false);
});

test("unchanged snapshots preserve open rows and closed updates do no DOM rebuilding", () => {
  const snapshot = { items: [record(2)] }, f = fixture(snapshot);
  f.update(snapshot);
  assert.equal(f.updates(), 0);
  f.trigger.dispatch("click");
  const row = f.menu.children[0];
  f.sent.render(); f.update(snapshot);
  assert.equal(f.menu.replaceCalls, 1);
  assert.equal(f.menu.children[0], row);
  assert.equal(f.updates(), 0);
  f.sent.close();
  f.update({ items: [record(3), record(2)] });
  assert.equal(f.updates(), 1);
  assert.equal(f.menu.replaceCalls, 1);
  f.trigger.dispatch("click");
  assert.equal(f.menu.replaceCalls, 2);
  assert.equal(f.menu.children[0].children[0].dataset.recentKey, `local:${id(3)}`);
  f.update(undefined);
  assert.equal(f.updates(), 1);
});

test("recent sent dismisses with Escape or outside pointer and removes global listeners on destroy", () => {
  const f = fixture({ items: [record(2)] });
  assert.equal(f.document.listenerCount("pointerdown"), 2);
  assert.equal(f.document.listenerCount("keydown"), 2);
  f.trigger.dispatch("click");
  f.document.dispatch("pointerdown", { target: f.menu.children[0] });
  assert.equal(f.menu.hidden, false);
  f.document.dispatch("keydown", { key: "Escape" });
  assert.equal(f.menu.hidden, true);
  assert.equal(f.document.activeElement, f.trigger);
  assert.equal(f.trigger.getAttribute("aria-expanded"), "false");
  f.trigger.dispatch("click");
  f.document.dispatch("pointerdown", { target: f.document.createElement("outside") });
  assert.equal(f.menu.hidden, true);
  f.sent.destroy(); f.recent.destroy();
  assert.equal(f.root.children.length, 0);
  assert.equal(f.menu.listenerCount("scroll"), 0);
  assert.equal(f.document.listenerCount("pointerdown"), 0);
  assert.equal(f.document.listenerCount("keydown"), 0);
});

test("tabs wire recent sent selection and snapshot refresh without another timer or observer", () => {
  const source = buildNativeRecentSentMenuInjectionSource();
  assert.doesNotMatch(source, /MutationObserver|setTimeout|setInterval|innerHTML/);
  const tabs = buildNativeConversationTabsInjectionSource();
  assert.match(tabs, /openLocal: \(tab\) => request\(tab, true\)/);
  assert.match(tabs, /updateRecentSent: \(\) => recentSentMenu\?\.render\(\)/);
  assert.match(tabs, /recentSentMenu\?\.destroy\(\)/);
  assert.doesNotThrow(() => new Function(tabs));
});
