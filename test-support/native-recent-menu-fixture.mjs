import vm from "node:vm";
import { buildNativeConversationWindowInjectionSource } from "../src/native-conversation-window.mjs";
import { buildNativeRecentConversationMenuInjectionSource } from "../src/native-recent-conversations.mjs";
import { normalizeRecentSentSnapshot, buildNativeRecentSentMenuInjectionSource, buildNativeRecentSentSnapshotScript } from "../src/native-recent-sent-conversations.mjs";
export const id = (number) => `00000000-0000-0000-0000-${String(number).padStart(12, "0")}`;
export const record = (number, minute = number) => ({ kind: "local", id: id(number), title: `会话 ${number}`, lastUserMessageAt: `2026-09-22T10:${String(minute).padStart(2, "0")}:00.000Z` });

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
    this.scrollTop = 0; this.scrollHeight = 0;
  }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.get(name) ?? null; }
  removeAttribute(name) { this.attrs.delete(name); }
  append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
  prepend(...children) { for (const child of children) child.parent = this; this.children.unshift(...children); }
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

export function fixture(snapshot = { items: [] }) {
  const document = new Events();
  document.createElement = (tag) => new Element(document, tag);
  document.createElementNS = (_namespace, tag) => new Element(document, tag);
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
