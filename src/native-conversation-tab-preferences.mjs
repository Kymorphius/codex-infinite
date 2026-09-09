export function normalizeNativeConversationTabWheelDirection(value) {
  return value === "reversed" ? "reversed" : "standard";
}

export function nativeConversationTabWheelOffset(delta, direction = "standard") {
  const sign = Math.sign(Number(delta) || 0);
  return normalizeNativeConversationTabWheelDirection(direction) === "reversed" ? sign : -sign;
}

export function installNativeConversationTabWheelPreferences({ root, state, persist, adjacentKey, activate, advanceMomentum }) {
  let accumulator = 0;
  let momentum = {};
  let panel = null;

  const style = document.createElement("style");
  style.setAttribute("data-codex-control-console-native-tab-preference-style", "");
  style.textContent = '.ccc-native-tab-settings{display:grid;width:26px;height:26px;flex:0 0 26px;place-items:center;border:0;border-radius:7px;padding:0;background:transparent;color:inherit;font:16px/1 -apple-system,system-ui,sans-serif;cursor:pointer;opacity:.72}.ccc-native-tab-settings:hover,.ccc-native-tab-settings[aria-expanded="true"]{background:color-mix(in srgb,currentColor 10%,transparent);opacity:1}[data-codex-control-console-native-tab-preferences]{position:fixed;z-index:2147483646;min-width:224px;padding:6px;border:1px solid color-mix(in srgb,currentColor 15%,transparent);border-radius:10px;background:var(--color-background-primary,#202022);color:var(--color-text,#eee);box-shadow:0 10px 30px rgba(0,0,0,.24);font:13px/20px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}[data-codex-control-console-native-tab-preferences] .ccc-native-tab-preference-title{padding:4px 8px 5px;font-weight:600}[data-codex-control-console-native-tab-preferences] button{display:flex;width:100%;align-items:center;gap:8px;border:0;border-radius:7px;padding:7px 8px;background:transparent;color:inherit;text-align:left;font:inherit;cursor:pointer}[data-codex-control-console-native-tab-preferences] button:hover{background:color-mix(in srgb,currentColor 9%,transparent)}[data-codex-control-console-native-tab-preferences] button::before{width:14px;content:""}[data-codex-control-console-native-tab-preferences] button[aria-checked="true"]::before{content:"✓"}';
  document.head.append(style);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "ccc-native-tab-settings";
  button.textContent = "⚙︎";
  button.setAttribute("aria-label", "标签设置");
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  button.title = "标签设置";
  root.append(button);

  function close() {
    panel?.remove();
    panel = null;
    button.setAttribute("aria-expanded", "false");
  }

  function choose(direction) {
    state.wheelDirection = normalizeNativeConversationTabWheelDirection(direction);
    persist();
    close();
  }

  function open() {
    close();
    panel = document.createElement("div");
    panel.setAttribute("data-codex-control-console-native-tab-preferences", "");
    panel.setAttribute("role", "menu");
    panel.setAttribute("aria-label", "标签设置");
    const title = document.createElement("div");
    title.className = "ccc-native-tab-preference-title";
    title.textContent = "滚动方向";
    panel.append(title);
    for (const [direction, label] of [["standard", "标准（上滚向右）"], ["reversed", "反向（上滚向左）"]]) {
      const option = document.createElement("button");
      option.type = "button";
      option.setAttribute("role", "menuitemradio");
      option.setAttribute("aria-checked", String(state.wheelDirection === direction));
      option.textContent = label;
      option.addEventListener("click", () => choose(direction));
      panel.append(option);
    }
    document.body.append(panel);
    const anchor = button.getBoundingClientRect();
    const bounds = panel.getBoundingClientRect();
    panel.style.left = Math.max(8, Math.min(anchor.right - bounds.width, innerWidth - bounds.width - 8)) + "px";
    panel.style.top = Math.max(8, Math.min(anchor.bottom + 6, innerHeight - bounds.height - 8)) + "px";
    button.setAttribute("aria-expanded", "true");
  }

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (panel) close(); else open();
  });
  const outsideClick = (event) => { if (panel && !panel.contains(event.target) && event.target !== button) close(); };
  const escape = (event) => { if (event.key === "Escape" && panel) { close(); button.focus(); } };
  document.addEventListener("click", outsideClick, true);
  document.addEventListener("keydown", escape, true);
  window.addEventListener("resize", close);

  root.addEventListener("wheel", (event) => {
    if (!event.deltaY || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? innerHeight : 1);
    momentum = advanceMomentum(momentum, delta, performance.now());
    if (momentum.resetAccumulator) accumulator = 0;
    if (momentum.ignoring) return;
    if (accumulator && Math.sign(accumulator) !== Math.sign(delta)) accumulator = 0;
    accumulator += delta;
    if (Math.abs(accumulator) < 32) return;
    const next = adjacentKey(nativeConversationTabWheelOffset(accumulator, state.wheelDirection));
    accumulator = 0;
    if (next !== state.activeKey) activate(next);
  }, { passive: false });

  return {
    close,
    destroy() {
      close();
      document.removeEventListener("click", outsideClick, true);
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("resize", close);
      button.remove();
      style.remove();
    }
  };
}
