import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { buildNativeTurnStateInjectionScript, buildNativeTurnStateSnapshotScript, nativeTurnStateTone, normalizeNativeTurnStateSnapshot, summarizeGlobalNativeTurnStates, summarizeNativeTurnState, summarizeNativeTurnStates } from "../src/native-turn-state-status.mjs";

const current = "01a0c463-6db9-7672-92d6-62b6367c3114";
const other = "01a0c47f-f950-79b3-80fd-bd634f05ee17";
const turnId = "01a0c4aa-1111-7222-8333-123456789abc";

test("current turn-state length is green and historical length is neutral", () => {
  assert.equal(nativeTurnStateTone({ turnState: { present: true, length: 780 } }), "#62bd84");
  assert.equal(nativeTurnStateTone({ turnState: { present: true, length: 292 } }), "#a7a7ad");
  assert.equal(nativeTurnStateTone({ turnState: { present: true, length: 312 } }), "#d39a19");
  assert.equal(nativeTurnStateTone({ turnState: { present: true, length: 999 } }), "#8ab4f8");
  assert.equal(nativeTurnStateTone({ turnState: { present: false } }), "#a7a7ad");
});

test("native turn-state summaries remain conversation scoped", () => {
  const snapshot = normalizeNativeTurnStateSnapshot({ available: true, observedAt: 50, entries: [{ threadId: current, turnId, model: "gpt-5.6-sol", status: 200, upstreamAttempts: 1, endedAt: 40, turnState: { present: true, length: 292, value: "private" } }, { threadId: other, model: "gpt-6-astra", status: 200, turnState: { present: true, length: 312 } }, { threadId: current, turnId, model: "gpt-5.6-sol", status: 200, endedAt: 50, turnState: { present: false } }] });
  const summary = summarizeNativeTurnStates(snapshot, current);
  assert.equal(summary.entries.length, 2);
  assert.deepEqual(summary.counts, { none: 1, 292: 1 });
  assert.deepEqual(summary.latest.turnState, { present: true, length: 292 });
  assert.equal(summarizeNativeTurnState(snapshot, current, turnId).latest.turnId, turnId);
  assert.deepEqual(summarizeNativeTurnState(snapshot, current, turnId).latest.turnState, { present: true, length: 292 });
  assert.equal(summarizeNativeTurnState(snapshot, current, other).latest, null);
  assert.doesNotMatch(JSON.stringify(snapshot), /private/);
  assert.doesNotMatch(JSON.stringify(summary), /gpt-6-astra/);
});

test("native injection renders header and exact-turn badges with an explicit quality disclaimer", () => {
  const source = buildNativeTurnStateInjectionScript();
  assert.match(source, /data-codex-control-console-turn-state/);
  assert.match(source, /String\(entry\.turnState\.length\)/);
  assert.match(source, /长度本身不代表模型质量/);
  assert.match(source, /780 是当前正常长度，292 是历史长度/);
  assert.match(source, /const toneFor = function nativeTurnStateTone/);
  assert.match(source, /data-above-composer-conversation-id/);
  assert.match(source, /data-content-search-turn-key/);
  assert.match(source, /data-codex-control-console-turn-state-turn/);
  assert.match(source, /data-codex-control-console-native-jev-current/);
  assert.match(source, /data-codex-control-console-global-turn-state/);
  assert.match(source, /header\[data-app-shell-header-layout\]/);
  assert.match(source, /jev\.after\(button\)/);
  assert.doesNotMatch(source, /button\[aria-label=\\"搜索\\"\]/);
  assert.match(source, /const summarizeNativeTurnStates = summarize/);
  const snapshot = buildNativeTurnStateSnapshotScript({ available: true, entries: [{ threadId: current, turnState: { present: true, length: 292 } }] });
  assert.match(snapshot, /SetTurnStateSnapshot/);
  assert.doesNotMatch(snapshot, /x-codex-turn-state/);
});

test("global summary keeps one latest effective state per conversation", () => {
  const snapshot = normalizeNativeTurnStateSnapshot({ available: true, entries: [
    { threadId: current, endedAt: 10, turnState: { present: true, length: 292 } },
    { threadId: current, endedAt: 20, turnState: { present: false } },
    { threadId: other, endedAt: 30, turnState: { present: true, length: 312 } },
    { threadId: "01a0c4bb-2222-7333-8444-123456789abc", endedAt: 40, turnState: { present: false } },
  ] });
  const summary = summarizeGlobalNativeTurnStates(snapshot);
  assert.equal(summary.conversationCount, 3);
  assert.deepEqual(summary.counts, { 292: 1, 312: 1, none: 1 });
  assert.deepEqual(summary.latest.turnState, { present: true, length: 312 });
});

test("republishing an unchanged snapshot leaves the button alone and keeps its composer slot", () => {
  // Regression: the render signature included observedAt, which is fresh on every service sync, so the
  // button's text, title and whole inline style were rewritten each cycle; that also wiped the `order`
  // native-composer-control-order had set, which it then restored (10 real style changes per 10s).
  let cssWrites = 0, order = "", created = null;
  const host = { children: [] };
  const jev = { parentElement: host };
  jev.after = (node) => { node.parentElement = host; node.previousElementSibling = jev; };
  const makeButton = () => {
    const node = { dataset: {}, title: "", textContent: "", attrs: {}, parentElement: null, previousElementSibling: null,
      setAttribute(name, value) { this.attrs[name] = value; }, addEventListener() {}, remove() {} };
    node.style = { get order() { return order; }, set order(value) { order = value; }, set cssText(value) { cssWrites++; order = ""; } };
    return (created = node);
  };
  const document = {
    querySelector: (selector) => selector === "button[data-codex-control-console-native-jev-current]" ? jev : selector === "[data-codex-control-console-turn-state]" ? created : null,
    querySelectorAll: (selector) => selector === "[data-above-composer-conversation-id]" ? [{ getAttribute: () => current }] : [],
    createElement: makeButton
  };
  const window = {};
  vm.runInNewContext(buildNativeTurnStateInjectionScript(), { window, document, setInterval: () => 1, clearInterval() {}, Date, JSON, Number, Array, Object, String, Set, Map, Math });
  const publish = (observedAt, length) => window.__codexControlConsoleSetTurnStateSnapshot(normalizeNativeTurnStateSnapshot({ available: true, observedAt, entries: [{ threadId: current, turnId, model: "gpt-5.6-sol", status: 200, endedAt: 40, turnState: { present: true, length } }] }));
  publish(100, 780);
  assert.equal(created.textContent, "780");
  const settled = cssWrites; // install renders "unavailable" once, then the first snapshot renders the data
  order = "1"; // native-composer-control-order places the button
  for (const observedAt of [200, 300, 400, 500]) publish(observedAt, 780);
  assert.equal(cssWrites, settled, "a newer observation of the same data rewrites nothing");
  assert.equal(order, "1");
  publish(600, 292);
  assert.equal(created.textContent, "292"); assert.equal(cssWrites, settled + 1, "changed data is still rendered");
  assert.equal(order, "1", "and keeps the composer slot");
});

test("the global quality button joins the Windows menu bar in the menu items' style, and keeps its pill elsewhere", () => {
  // Windows draws an in-page menu bar (文件 编辑 视图 帮助); macOS has none. The button reuses the menu items'
  // classes there so size, radius, font and hover match; without the bar it stays the header-slot pill.
  const build = (withMenuBar, withComposer = true) => {
    const buttons = [], slot = { children: [], append(node) { node.parentElement = slot; node.previousElementSibling = null; } };
    const menuHost = { children: [] };
    const help = { className: 'no-drag rounded-md border border-transparent px-2.5 py-1', parentElement: menuHost };
    help.after = (node) => { node.parentElement = menuHost; node.previousElementSibling = help; };
    const jevHost = { children: [] }, jev = { parentElement: jevHost };
    jev.after = (node) => { node.parentElement = jevHost; node.previousElementSibling = jev; };
    const global = () => buttons.find((node) => "data-codex-control-console-global-turn-state" in node.attrs);
    const document = {
      querySelector: (selector) => selector === "button[data-codex-control-console-native-jev-current]" ? (withComposer ? jev : null)
        : selector === "#application-menu-trigger-help-menu" ? (withMenuBar ? help : null)
        : selector.startsWith("header[data-app-shell-header-layout]") || selector === "[data-test-id=\"header-shell-slot\"]" ? slot
        : selector === "[data-codex-control-console-global-turn-state]" ? global() || null
        : selector === "[data-codex-control-console-turn-state]" ? buttons.find((node) => "data-codex-control-console-turn-state" in node.attrs) || null : null,
      querySelectorAll: (selector) => selector === "[data-above-composer-conversation-id]" ? [{ getAttribute: () => current }] : [],
      createElement: () => { const node = { dataset: {}, attrs: {}, className: "", title: "", textContent: "", parentElement: null, previousElementSibling: null, style: { set cssText(value) { this.css = value; }, get cssText() { return this.css || ""; }, order: "" },
        setAttribute(name, value) { this.attrs[name] = value; }, addEventListener() {}, remove() {} }; buttons.push(node); return node; }
    };
    const window = {};
    vm.runInNewContext(buildNativeTurnStateInjectionScript(), { window, document, setInterval: () => 1, clearInterval() {}, Date, JSON, Number, Array, Object, String, Set, Map, Math });
    window.__codexControlConsoleSetTurnStateSnapshot(normalizeNativeTurnStateSnapshot({ available: true, observedAt: 1, entries: [{ threadId: current, turnId, model: "gpt-5.6-sol", status: 200, endedAt: 40, turnState: { present: true, length: 780 } }] }));
    return { button: global(), help, menuHost, slot };
  };
  const windows = build(true);
  assert.equal(windows.button.parentElement, windows.menuHost, "in the menu bar row");
  assert.equal(windows.button.previousElementSibling, windows.help, "right after 帮助");
  assert.equal(windows.button.className, windows.help.className, "same classes as the menu items");
  assert.equal(windows.button.textContent, "质量 780");
  assert.match(windows.button.style.cssText, /^color:#62bd84;/, "only the state colour is added");
  assert.doesNotMatch(windows.button.style.cssText, /border|background|font|position/, "no pill styling of its own");
  // Regression: after restoring straight into a terminal the native composer never renders; the button must not
  // depend on it.
  const noComposer = build(true, false);
  assert.equal(noComposer.button?.parentElement, noComposer.menuHost, "rendered without any native composer");
  assert.equal(noComposer.button?.textContent, "质量 780");
  const mac = build(false);
  assert.equal(mac.button.parentElement, mac.slot, "without a menu bar it stays in the header slot");
  assert.equal(mac.button.textContent, "780");
  assert.match(mac.button.style.cssText, /position:absolute;right:12px;top:50%;z-index:40;transform:translateY\(-50%\)/, "and is not shifted from the header's midline");
  assert.match(mac.button.style.cssText, /border-radius:999px/);
});
