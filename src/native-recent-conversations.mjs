export function recentNativeConversationRecords(tabs = [], activeKey = "", limit = 12) {
  const boundedLimit = Math.max(1, Math.min(40, Number(limit) || 12));
  const records = [];
  const seen = new Set();
  const active = activeKey ? [...tabs].reverse().find((tab) => tab?.key === activeKey) : null;
  if (active) {
    records.push(active);
    seen.add(activeKey);
  }
  for (let index = tabs.length - 1; index >= 0 && records.length < boundedLimit; index -= 1) {
    const tab = tabs[index];
    const key = String(tab?.key || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    records.push(tab);
  }
  return records;
}

export function openNativeConversationPages(tabs = [], activeKey = "console") {
  if (activeKey === "console") return [];
  const active = tabs.find((tab) => tab?.key === activeKey);
  return active ? [active] : [];
}

export function installNativeRecentConversationMenu({
  documentRef,
  root,
  state,
  keyFor,
  activate,
  openWindow,
  limit = 12,
  label = "最近会话",
  icon = "↶",
  hint = "最近打开过的会话",
  readRecords = null,
  readStatus = () => "",
  emptyText = "暂无最近会话",
  detailFor = null,
  onSelect = null
}) {
  const host = documentRef.createElement("div");
  host.className = "ccc-native-recent";
  host.dataset.recentMenu = readRecords ? "sent" : "opened";
  const trigger = documentRef.createElement("button");
  trigger.type = "button";
  trigger.className = "ccc-native-recent-trigger";
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-label", label);
  trigger.title = hint;
  const triggerIcon = documentRef.createElement("span");
  triggerIcon.className = "ccc-native-recent-icon";
  triggerIcon.setAttribute("aria-hidden", "true");
  triggerIcon.textContent = icon;
  const triggerLabel = documentRef.createElement("span");
  triggerLabel.textContent = label;
  const triggerChevron = documentRef.createElement("span");
  triggerChevron.className = "ccc-native-recent-chevron";
  triggerChevron.setAttribute("aria-hidden", "true");
  triggerChevron.textContent = "⌄";
  trigger.append(triggerIcon, triggerLabel, triggerChevron);

  const menu = documentRef.createElement("div");
  menu.className = "ccc-native-recent-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", label);
  menu.hidden = true;
  host.append(trigger, menu);
  root.append(host);

  const close = ({ focus = false } = {}) => {
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    if (focus) trigger.focus();
  };

  let renderedSignature = "";
  const render = () => {
    if (menu.hidden) return;
    const records = readRecords ? readRecords().slice(0, limit).map((tab) => ({ ...tab, key: keyFor(tab) })) : recentNativeConversationRecords(
      state.tabs.map((tab) => ({ ...tab, key: keyFor(tab) })),
      state.activeKey,
      limit
    );
    const status = readStatus();
    const signature = JSON.stringify([records, state.activeKey, status]);
    if (signature === renderedSignature) return;
    renderedSignature = signature;
    if (!records.length) {
      const empty = documentRef.createElement("p");
      empty.className = "ccc-native-recent-empty";
      empty.textContent = status || emptyText;
      menu.replaceChildren(empty);
      return;
    }
    const rows = records.map((tab) => {
      const row = documentRef.createElement("div");
      row.className = "ccc-native-recent-row";
      row.setAttribute("role", "none");
      row.dataset.active = String(tab.key === state.activeKey);
      const select = documentRef.createElement("button");
      select.type = "button";
      select.className = "ccc-native-recent-select";
      select.setAttribute("role", "menuitem");
      select.dataset.recentKey = tab.key;
      const dot = documentRef.createElement("span");
      dot.className = "ccc-native-tab-dot";
      dot.dataset.kind = tab.kind;
      dot.setAttribute("aria-hidden", "true");
      const copy = documentRef.createElement("span");
      copy.className = "ccc-native-recent-copy";
      const title = documentRef.createElement("span");
      title.className = "ccc-native-recent-title";
      title.textContent = tab.title;
      const detail = documentRef.createElement("span");
      detail.className = "ccc-native-recent-detail";
      detail.textContent = detailFor ? detailFor(tab) : tab.kind === "remote" ? tab.deviceName || "远端会话" : tab.kind === "chatgpt" ? "ChatGPT" : "本地会话";
      copy.append(title, detail);
      select.append(dot, copy);
      select.addEventListener("click", () => {
        close();
        if (onSelect) onSelect(tab); else activate(tab.key);
      });
      row.append(select);
      const windowButton = createNativeConversationWindowButton(documentRef, tab, tab.key);
      if (windowButton) {
        windowButton.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          void openNativeConversationWindow({ state: { tabs: records }, keyFor, key: tab.key, button: windowButton, openWindow });
        });
        row.append(windowButton);
      }
      return row;
    });
    if (status) {
      const notice = documentRef.createElement("p");
      notice.className = "ccc-native-recent-empty";
      notice.setAttribute("role", "status");
      notice.textContent = status;
      rows.unshift(notice);
    }
    menu.replaceChildren(...rows);
  };

  trigger.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const opening = menu.hidden;
    menu.hidden = !opening;
    if (opening) render();
    trigger.setAttribute("aria-expanded", String(opening));
    if (opening) menu.querySelector('[role="menuitem"]')?.focus();
  });
  const outside = (event) => {
    if (!menu.hidden && !host.contains(event.target)) close();
  };
  const keyboard = (event) => {
    if (!menu.hidden && event.key === "Escape") {
      event.preventDefault();
      close({ focus: true });
    }
  };
  documentRef.addEventListener("pointerdown", outside, true);
  documentRef.addEventListener("keydown", keyboard, true);

  return {
    render,
    close,
    destroy() {
      documentRef.removeEventListener("pointerdown", outside, true);
      documentRef.removeEventListener("keydown", keyboard, true);
      host.remove();
    }
  };
}

export const NATIVE_RECENT_CONVERSATION_STYLE =
  '[data-codex-control-console-native-tabs]{container-type:inline-size;container-name:ccc-native-tabs}' +
  '.ccc-native-recent{position:relative;display:flex;flex:0 0 auto;align-items:center}' +
  '.ccc-native-recent-trigger{display:flex;height:26px;align-items:center;gap:5px;border:0;border-radius:7px;padding:0 8px;background:transparent;color:inherit;font:500 12px/18px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer;white-space:nowrap}' +
  '.ccc-native-recent-trigger:hover,.ccc-native-recent-trigger[aria-expanded="true"]{background:color-mix(in srgb,currentColor 10%,transparent)}' +
  '.ccc-native-recent-icon{font-size:15px}.ccc-native-recent-chevron{font-size:11px;opacity:.65}' +
  '.ccc-native-recent-menu{position:absolute;top:34px;right:0;width:min(360px,calc(100vw - 32px));max-height:min(520px,calc(100vh - 70px));overflow:auto;border:1px solid color-mix(in srgb,currentColor 15%,transparent);border-radius:12px;padding:6px;background:var(--color-background-primary,#202022);color:var(--color-text,#eee);box-shadow:0 14px 42px rgba(0,0,0,.28);backdrop-filter:blur(22px)}' +
  '.ccc-native-recent-menu[hidden]{display:none}.ccc-native-recent-row{display:flex;align-items:center;gap:4px;border-radius:8px}' +
  '.ccc-native-recent-row[data-active="true"]{background:color-mix(in srgb,#6d8cff 14%,transparent)}' +
  '.ccc-native-recent-select{display:flex;min-width:0;flex:1;align-items:center;gap:9px;border:0;border-radius:8px;padding:8px;background:transparent;color:inherit;text-align:left;cursor:pointer}' +
  '.ccc-native-recent-select:hover,.ccc-native-recent-select:focus-visible{background:color-mix(in srgb,currentColor 9%,transparent);outline:none}' +
  '.ccc-native-recent-copy{display:flex;min-width:0;flex:1;flex-direction:column}.ccc-native-recent-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:500 13px/17px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}' +
  '.ccc-native-recent-detail{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:400 11px/15px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;opacity:.58}' +
  '.ccc-native-recent-empty{margin:0;padding:18px;text-align:center;font:12px/18px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;opacity:.6}' +
  '@container ccc-native-tabs (max-width:430px){.ccc-native-recent-trigger>span:nth-child(2){display:none}}' +
  '@media(max-width:720px){.ccc-native-recent-trigger>span:nth-child(2){display:none}.ccc-native-recent-menu{right:-4px}}';

export function buildNativeRecentConversationMenuInjectionSource() {
  return [
    recentNativeConversationRecords,
    openNativeConversationPages,
    installNativeRecentConversationMenu
  ].map((value) => value.toString()).join("\n");
}
