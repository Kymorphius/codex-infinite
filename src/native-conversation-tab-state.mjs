import { reorderNativeConversationTabs } from "./native-conversation-tab-drag.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCAL_TAB_KEY = /^local:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const MAX_PERSISTED_TABS = 40;
const CONSOLE_MODULES = new Set(["board", "console", "sessions", "context", "priority", "zotero"]);

function boundedText(value, maxLength) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function normalizeNativeConversationTab(tab = {}) {
  const kind = tab.kind === "remote" ? "remote" : tab.kind === "local" ? "local" : tab.kind === "chatgpt" ? "chatgpt" : null;
  const id = boundedText(tab.id, 160);
  if (!kind || !id || (kind !== "remote" && !UUID.test(id))) return null;
  const deviceId = kind === "remote" ? boundedText(tab.deviceId, 120) : "local";
  if (!deviceId) return null;
  return Object.freeze({
    key: kind === "local" ? `local:${id.toLowerCase()}` : kind === "chatgpt" ? `chatgpt:${id.toLowerCase()}` : `remote:${encodeURIComponent(deviceId)}/${encodeURIComponent(id)}`,
    kind,
    id: kind === "remote" ? id : id.toLowerCase(),
    deviceId,
    title: boundedText(tab.title, 160) || "未命名会话",
    cwd: boundedText(tab.cwd, 1024),
    deviceName: boundedText(tab.deviceName, 80)
  });
}

export function normalizeNativeConversationTabHistory(value = {}) {
  const tabs = [];
  const keys = new Set();
  for (const candidate of Array.isArray(value?.tabs) ? value.tabs : []) {
    const tab = normalizeNativeConversationTab(candidate);
    if (!tab || keys.has(tab.key)) continue;
    keys.add(tab.key);
    tabs.push(tab);
    if (tabs.length >= MAX_PERSISTED_TABS) break;
  }
  const activeKey = value?.activeKey === "console" || keys.has(value?.activeKey) ? value.activeKey : "console";
  const consoleModule = CONSOLE_MODULES.has(value?.consoleModule) ? value.consoleModule : "board";
  const dismissedLocalKeys = [];
  const dismissed = new Set();
  for (const candidate of Array.isArray(value?.dismissedLocalKeys) ? value.dismissedLocalKeys : []) {
    const match = LOCAL_TAB_KEY.exec(String(candidate || ""));
    const key = match ? `local:${match[1].toLowerCase()}` : "";
    if (!key || keys.has(key) || dismissed.has(key)) continue;
    dismissed.add(key);
    dismissedLocalKeys.push(key);
    if (dismissedLocalKeys.length >= MAX_PERSISTED_TABS) break;
  }
  return Object.freeze({ tabs: Object.freeze(tabs), activeKey, consoleModule, dismissedLocalKeys: Object.freeze(dismissedLocalKeys) });
}

export function adjacentNativeConversationTabKey(tabs = [], activeKey = "console", direction = 0) {
  const keys = ["console", ...tabs.map((tab) => tab?.key).filter(Boolean)];
  const activeIndex = Math.max(0, keys.indexOf(activeKey));
  const offset = direction < 0 ? -1 : direction > 0 ? 1 : 0;
  return keys[(activeIndex + offset + keys.length) % keys.length] || "console";
}

export function advanceNativeTabClickSequence(state = {}, key = "", timestamp = 0) {
  const value = String(key || "");
  const previousAt = Number(state.at) || 0;
  const now = Number(timestamp) || 0;
  const close = Boolean(value && value !== "console" && state.key === value && now >= previousAt && now - previousAt <= 500);
  return close ? { key: "", at: 0, close: true } : { key: value, at: now, close: false };
}

export function advanceNativeWheelMomentum(state = {}, delta = 0, timestamp = 0) {
  const direction = Math.sign(delta);
  const magnitude = Math.abs(delta);
  const previousAt = Number(state.lastAt) || 0;
  const previousMagnitude = Number(state.lastMagnitude) || 0;
  const previousDirection = Number(state.lastDirection) || 0;
  const freshInput = !previousAt || timestamp - previousAt > 96 || direction !== previousDirection;
  let decayStreak = freshInput ? 0 : Number(state.decayStreak) || 0;
  let ignoring = freshInput ? false : Boolean(state.ignoring);
  let resetAccumulator = freshInput;
  if (!freshInput && ignoring && magnitude > previousMagnitude * 1.35 + 1) {
    ignoring = false;
    decayStreak = 0;
    resetAccumulator = true;
  } else if (!freshInput && !ignoring) {
    decayStreak = magnitude < previousMagnitude ? decayStreak + 1 : 0;
    if (decayStreak >= 3) {
      ignoring = true;
      resetAccumulator = true;
    }
  }
  return { lastAt: timestamp, lastMagnitude: magnitude, lastDirection: direction, decayStreak, ignoring, resetAccumulator };
}

export class NativeConversationTabState {
  constructor(history = {}) {
    const normalized = normalizeNativeConversationTabHistory(history);
    this.tabs = [...normalized.tabs];
    this.activeKey = normalized.activeKey;
    this.consoleModule = normalized.consoleModule;
    this.dismissedLocalKeys = [...normalized.dismissedLocalKeys];
  }

  open(tab, { explicit = true } = {}) {
    const value = normalizeNativeConversationTab(tab);
    if (!value) return null;
    if (value.kind === "local" && this.dismissedLocalKeys.includes(value.key)) {
      if (!explicit) return null;
      this.dismissedLocalKeys = this.dismissedLocalKeys.filter((key) => key !== value.key);
    }
    const index = this.tabs.findIndex((item) => item.key === value.key);
    if (index < 0) this.tabs.push(value);
    else this.tabs[index] = value;
    this.activeKey = value.key;
    return value;
  }

  showConsole(module = this.consoleModule) {
    if (CONSOLE_MODULES.has(module)) this.consoleModule = module;
    this.activeKey = "console";
    return { kind: "console", key: "console", module: this.consoleModule };
  }

  activate(key) {
    if (key === "console") return this.showConsole();
    const tab = this.tabs.find((item) => item.key === key);
    if (!tab) return null;
    this.activeKey = key;
    return tab;
  }

  close(key) {
    const index = this.tabs.findIndex((item) => item.key === key);
    if (index < 0) return this.active();
    if (this.tabs[index].kind === "local") {
      this.dismissedLocalKeys = [...this.dismissedLocalKeys.filter((value) => value !== key), key].slice(-MAX_PERSISTED_TABS);
    }
    const wasActive = this.activeKey === key;
    this.tabs.splice(index, 1);
    if (!wasActive) return this.active();
    const next = this.tabs[index] || this.tabs[index - 1];
    if (next) {
      this.activeKey = next.key;
      return next;
    }
    return this.showConsole();
  }

  move(movingKey, targetKey, placeAfter = false) {
    this.tabs = reorderNativeConversationTabs(this.tabs, movingKey, targetKey, placeAfter);
    return this.active();
  }

  active() {
    if (this.activeKey === "console") return { kind: "console", key: "console", module: this.consoleModule };
    return this.tabs.find((item) => item.key === this.activeKey) || null;
  }
}
