export function nativeConversationWindowRequest(tab) {
  const kind = tab?.kind === "local" || tab?.kind === "chatgpt" ? tab.kind : null;
  const id = String(tab?.id || "").trim().toLowerCase();
  if (!kind || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  return {
    type: "open-in-new-window",
    path: `${kind === "local" ? "/local/" : "/c/"}${encodeURIComponent(id)}`
  };
}

export function createNativeConversationWindowButton(documentRef, tab, key) {
  if (!nativeConversationWindowRequest(tab)) return null;
  const button = documentRef.createElement("button");
  button.type = "button";
  button.draggable = false;
  button.className = "ccc-native-tab-window";
  button.dataset.windowKey = key;
  button.textContent = "↗";
  button.title = "在新窗口打开";
  button.setAttribute("aria-label", `在新窗口打开：${tab.title}`);
  return button;
}

export async function openNativeConversationWindow({ state, keyFor, key, button, openWindow }) {
  const tab = state.tabs.find((item) => keyFor(item) === key);
  const request = nativeConversationWindowRequest(tab);
  if (!request || typeof openWindow !== "function") return false;
  button?.setAttribute("data-window-opening", "");
  try {
    const opened = await openWindow(tab, request);
    if (opened === false) throw new Error("native window bridge unavailable");
    button?.setAttribute("data-window-opened", "");
    return true;
  } catch {
    button?.setAttribute("data-window-error", "");
    if (button) button.title = "无法在新窗口打开";
    return false;
  } finally {
    button?.removeAttribute("data-window-opening");
  }
}

export const NATIVE_CONVERSATION_WINDOW_STYLE =
  '[data-codex-control-console-native-tabs] .ccc-native-tab-window,[data-codex-control-console-native-tabs] .ccc-native-tab-close{display:grid;width:18px;height:18px;flex:0 0 18px;place-items:center;border:0;border-radius:5px;padding:0;background:transparent;color:inherit;cursor:pointer;opacity:.62}' +
  '[data-codex-control-console-native-tabs] .ccc-native-tab-window{font:13px/18px inherit}' +
  '[data-codex-control-console-native-tabs] .ccc-native-tab-close{font:16px/18px inherit}' +
  '[data-codex-control-console-native-tabs] .ccc-native-tab-window:hover,[data-codex-control-console-native-tabs] .ccc-native-tab-close:hover{background:color-mix(in srgb,currentColor 12%,transparent);opacity:1}' +
  '[data-codex-control-console-native-tabs] .ccc-native-tab-window[data-window-opening]{opacity:1;animation:ccc-window-opening .7s ease-in-out infinite alternate}' +
  '[data-codex-control-console-native-tabs] .ccc-native-tab-window[data-window-opened]{color:#42a575;opacity:1}' +
  '[data-codex-control-console-native-tabs] .ccc-native-tab-window[data-window-error]{color:#d65f5f;opacity:1}' +
  '@keyframes ccc-window-opening{to{transform:translate(1px,-1px)}}';

export function buildNativeConversationWindowInjectionSource() {
  return [
    nativeConversationWindowRequest,
    createNativeConversationWindowButton,
    openNativeConversationWindow
  ].map((value) => value.toString()).join("\n");
}
