import { updateClaudeStatus, updateNativeRecentDraft, updateNativeRecentStatus } from './native-recent-status.mjs';

export function recentNativeConversationRecords(tabs = [], activeKey = "", limit = 40) {
  const boundedLimit = Math.max(1, Math.min(40, Number(limit) || 40));
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
  limit = 40,
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
  const triggerIcon = documentRef.createElementNS("http://www.w3.org/2000/svg", "svg");
  triggerIcon.setAttribute("class", "ccc-native-recent-icon");
  triggerIcon.setAttribute("aria-hidden", "true");
  triggerIcon.setAttribute("viewBox", "0 0 24 24");
  triggerIcon.setAttribute("fill", "none");
  triggerIcon.setAttribute("stroke", "currentColor");
  triggerIcon.setAttribute("stroke-width", "1.8");
  triggerIcon.setAttribute("stroke-linecap", "round");
  triggerIcon.setAttribute("stroke-linejoin", "round");
  const symbol = documentRef.createElementNS("http://www.w3.org/2000/svg", "path");
  symbol.setAttribute("d", icon === "↑" ? "M12 19V5m-6 6 6-6 6 6" : "M3 12a9 9 0 1 0 2.6-6.4M3 4v5h5m4-1v5l3 2");
  triggerIcon.append(symbol);
  const triggerLabel = documentRef.createElement("span");
  triggerLabel.textContent = label;
  const triggerChevron = documentRef.createElementNS("http://www.w3.org/2000/svg", "svg");
  triggerChevron.setAttribute("class", "ccc-native-recent-chevron");
  triggerChevron.setAttribute("aria-hidden", "true");
  triggerChevron.setAttribute("viewBox", "0 0 24 24");
  triggerChevron.setAttribute("fill", "none");
  triggerChevron.setAttribute("stroke", "currentColor");
  triggerChevron.setAttribute("stroke-width", "2");
  triggerChevron.setAttribute("stroke-linecap", "round");
  triggerChevron.setAttribute("stroke-linejoin", "round");
  const chevronPath = documentRef.createElementNS("http://www.w3.org/2000/svg", "path");
  chevronPath.setAttribute("d", "m6 15 6-6 6 6");
  triggerChevron.append(chevronPath);
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

  let renderedSignature = "", renderedStatus = "", renderedCount = 0, currentRecords = [], visibleRows = [];
  const updateStatusIcon = (row, tab) => {
    const live = window.__codexControlConsoleAttentionConversations?.status?.(tab.id);
    updateNativeRecentStatus(documentRef, row, tab, live, () => window.__cccTerminalConversations?.records?.() || []);
    updateNativeRecentDraft(row, tab, live);
  };
  const createRow = (tab, records) => {
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
    if (tab.kind === "local" || (tab.kind === "terminal" && tab.engine !== "shell")) dot.className += " ccc-native-recent-status";
    else dot.setAttribute("aria-hidden", "true");
    row.statusDot = dot;
    const copy = documentRef.createElement("span");
    copy.className = "ccc-native-recent-copy";
    const title = documentRef.createElement("span");
    title.className = "ccc-native-recent-title";
    title.textContent = tab.title;
    const detail = documentRef.createElement("span");
    detail.className = "ccc-native-recent-detail";
    detail.textContent = detailFor ? detailFor(tab) : tab.kind === "remote" ? tab.deviceName || "远端会话" : tab.kind === "chatgpt" ? "ChatGPT" : tab.kind === "terminal" ? (tab.engine === "shell" ? "Shell" : tab.companionOf ? "Claude 伴生" : "Claude CLI") : "本地会话";
    copy.append(title, detail);
    row.titleNode = title;
    row.detailNode = detail;
    select.append(dot, copy);
    const draftMark = documentRef.createElement("span");
    draftMark.className = "ccc-native-recent-draft";
    draftMark.hidden = true;
    row.draftMark = draftMark;
    select.append(draftMark);
    // Claude rows carry the same amber tag as the sidebar so they stand out among Codex rows.
    if (tab.kind === "terminal" && tab.engine !== "shell") {
      const tag = documentRef.createElement("span");
      tag.className = "ccc-native-recent-engine";
      tag.textContent = tab.companionOf ? "伴生" : "CLI";
      tag.title = tab.companionOf ? "Claude 伴生会话" : "Claude CLI 会话";
      select.append(tag);
    }
    updateStatusIcon(row, tab);
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
  };
  const appendPage = () => {
    const next = currentRecords.slice(renderedCount, renderedCount + 12);
    if (!next.length) return;
    const rows = next.map((tab) => createRow(tab, currentRecords));
    const height = menu.scrollHeight, top = menu.scrollTop;
    menu.prepend(...rows.slice().reverse());
    menu.scrollTop = top + menu.scrollHeight - height;
    visibleRows.push(...rows);
    renderedCount += next.length;
  };
  const fillViewport = () => {
    while (renderedCount < currentRecords.length && menu.clientHeight > 0 && menu.scrollHeight <= menu.clientHeight + 1) appendPage();
  };
  const render = () => {
    if (menu.hidden) return;
    const records = readRecords ? readRecords().slice(0, limit).map((tab) => ({ ...tab, key: keyFor(tab) })) : recentNativeConversationRecords(
      state.tabs.map((tab) => ({ ...tab, key: keyFor(tab) })),
      state.activeKey,
      limit
    );
    const status = readStatus();
    const signature = JSON.stringify([records, state.activeKey, status]);
    if (signature === renderedSignature) { visibleRows.forEach((row, index) => updateStatusIcon(row, currentRecords[index])); return; }
    if (status === renderedStatus && records.length === currentRecords.length
      && records.every((tab, index) => tab.key === currentRecords[index].key)) {
      renderedSignature = signature;
      currentRecords = records;
      visibleRows.forEach((row, index) => {
        const tab = records[index];
        row.dataset.active = String(tab.key === state.activeKey);
        if (row.titleNode.textContent !== tab.title) row.titleNode.textContent = tab.title;
        const detail = detailFor ? detailFor(tab) : tab.kind === "remote" ? tab.deviceName || "远端会话" : tab.kind === "chatgpt" ? "ChatGPT" : tab.kind === "terminal" ? (tab.engine === "shell" ? "Shell" : tab.companionOf ? "Claude 伴生" : "Claude CLI") : "本地会话";
        if (row.detailNode.textContent !== detail) row.detailNode.textContent = detail;
        updateStatusIcon(row, tab);
      });
      return;
    }
    const bottomGap = menu.scrollHeight - menu.scrollTop;
    const targetCount = Math.min(records.length, Math.max(12, renderedCount));
    renderedSignature = signature; renderedStatus = status; currentRecords = records; renderedCount = 0; visibleRows = [];
    if (!records.length) {
      const empty = documentRef.createElement("p");
      empty.className = "ccc-native-recent-empty";
      empty.textContent = status || emptyText;
      menu.replaceChildren(empty);
      return;
    }
    const rows = [];
    if (status) {
      const notice = documentRef.createElement("p");
      notice.className = "ccc-native-recent-empty";
      notice.setAttribute("role", "status");
      notice.textContent = status;
      rows.unshift(notice);
    }
    menu.replaceChildren(...rows);
    while (renderedCount < targetCount) appendPage();
    fillViewport();
    menu.scrollTop = Math.max(0, menu.scrollHeight - bottomGap);
  };

  const onScroll = () => {
    if (menu.hidden || renderedCount >= currentRecords.length) return;
    if (menu.scrollTop <= 48) { appendPage(); fillViewport(); }
  };
  menu.addEventListener("scroll", onScroll);

  trigger.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const opening = menu.hidden;
    menu.hidden = !opening;
    if (opening) {
      const previousSignature = renderedSignature;
      render();
      if (previousSignature === renderedSignature) visibleRows.forEach((row, index) => updateStatusIcon(row, currentRecords[index]));
    }
    trigger.setAttribute("aria-expanded", String(opening));
    if (opening) {
      visibleRows[0]?.querySelector('[role="menuitem"]')?.focus({ preventScroll: true });
      menu.scrollTop = menu.scrollHeight;
    }
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
      menu.removeEventListener("scroll", onScroll);
      documentRef.removeEventListener("pointerdown", outside, true);
      documentRef.removeEventListener("keydown", keyboard, true);
      host.remove();
    }
  };
}

export const NATIVE_RECENT_CONVERSATION_STYLE =
  '[data-codex-control-console-native-tabs]{container-type:inline-size;container-name:ccc-native-tabs}' +
  '.ccc-native-recent{position:relative;display:flex;flex:0 0 auto;align-items:center}' +
  '.ccc-native-recent-trigger{display:flex;height:28px;align-items:center;gap:7px;border:0;border-radius:7px;padding:0 9px;background:transparent;color:inherit;font:500 12px/18px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer;white-space:nowrap;transition:background .16s ease}' +
  '.ccc-native-recent-trigger:hover,.ccc-native-recent-trigger[aria-expanded="true"]{background:color-mix(in srgb,currentColor 8%,transparent)}' +
  '.ccc-native-recent-trigger:focus-visible{outline:2px solid color-mix(in srgb,currentColor 65%,transparent);outline-offset:-2px}' +
  '.ccc-native-recent-icon{width:15px;height:15px;flex:0 0 15px}.ccc-native-recent-chevron{width:11px;height:11px;flex:0 0 11px;opacity:.65}' +
  '@keyframes ccc-native-recent-status-spin{to{transform:rotate(360deg)}}' +
  '.ccc-native-recent-status{width:14px;height:14px;flex:0 0 14px;display:inline-flex;align-items:center;justify-content:center}' +
  '.ccc-native-recent-status svg{width:14px;height:14px;flex:none}' +
  '.ccc-native-recent-status[data-status-source="native"][data-native-running="true"] svg{animation:ccc-native-recent-status-spin 2s linear infinite}' +
  '.ccc-native-recent-status[data-status-source="native"],.ccc-native-recent-status[data-status]:not([data-status="unknown"]){background:none}' +
  '.ccc-native-recent-status[data-status-source="fallback"][data-status="active"]::before{content:"";width:10px;height:10px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:ccc-native-recent-status-spin 1s linear infinite}' +
  '.ccc-native-recent-status[data-status-source="fallback"][data-status="completed"][data-unread="false"]::before{content:"";width:9px;height:5px;border-left:2px solid currentColor;border-bottom:2px solid currentColor;transform:rotate(-45deg)}' +
  '.ccc-native-recent-status[data-status="completed"][data-unread="true"]::before{content:"";width:8px;height:8px;border-radius:50%;background:#7da9ff}.ccc-native-recent-status[data-status="completed"][data-unread="unknown"]::before{content:"";width:8px;height:8px;border:1px solid currentColor;border-radius:50%}' +
  '.ccc-native-recent-status[data-status-source="fallback"][data-status="pending"]::before{content:"";width:10px;height:10px;border:1.5px solid currentColor;border-radius:50%}' +
  '.ccc-native-recent-status[data-status-source="fallback"][data-status="interrupted"]::before{content:"Ⅱ";font-size:12px}' +
  '.ccc-native-recent-status[data-status-source="fallback"][data-status="error"]::before{content:"!";font:bold 12px/14px sans-serif}' +
  '.ccc-native-recent-status[data-status="quota"]{background:none;color:#d9a640}.ccc-native-recent-status[data-status="quota"]::before{content:"";width:12px;height:12px;background:currentColor;-webkit-mask:url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22%3E%3Cpath d=%22M4 1.5h8M4 14.5h8M5 1.5c0 3 3 4.5 3 6.5s-3 3.5-3 6.5M11 1.5c0 3-3 4.5-3 6.5s3 3.5 3 6.5%22 fill=%22none%22 stroke=%22black%22 stroke-width=%221.6%22 stroke-linecap=%22round%22/%3E%3C/svg%3E") center/contain no-repeat;mask:url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22%3E%3Cpath d=%22M4 1.5h8M4 14.5h8M5 1.5c0 3 3 4.5 3 6.5s-3 3.5-3 6.5M11 1.5c0 3-3 4.5-3 6.5s3 3.5 3 6.5%22 fill=%22none%22 stroke=%22black%22 stroke-width=%221.6%22 stroke-linecap=%22round%22/%3E%3C/svg%3E") center/contain no-repeat}' +
  '.ccc-native-recent-status[data-quiet="true"]{background:none!important}.ccc-native-recent-status[data-quiet="true"]::before{content:none!important}' +
  '.ccc-native-recent-menu{position:absolute;bottom:34px;left:0;width:min(360px,calc(100vw - 32px));max-height:min(520px,calc(100vh - 120px));overflow:auto;border:1px solid color-mix(in srgb,currentColor 15%,transparent);border-radius:12px;padding:6px;background:var(--color-background-primary,#202022);color:var(--color-text,#eee);box-shadow:0 14px 42px rgba(0,0,0,.28);backdrop-filter:blur(22px)}' +
  '.ccc-native-recent-menu{overflow-anchor:none}.ccc-native-recent-menu[hidden]{display:none}.ccc-native-recent-row{display:flex;align-items:center;gap:4px;border-radius:8px}' +
  '.ccc-native-recent-row[data-active="true"]{background:color-mix(in srgb,#6d8cff 14%,transparent)}' +
  '.ccc-native-recent-select{display:flex;min-width:0;flex:1;align-items:center;gap:9px;border:0;border-radius:8px;padding:8px;background:transparent;color:inherit;text-align:left;cursor:pointer}' +
  '.ccc-native-recent-select:hover,.ccc-native-recent-select:focus-visible{background:color-mix(in srgb,currentColor 9%,transparent);outline:none}' +
  '.ccc-native-recent-copy{display:flex;min-width:0;flex:1;flex-direction:column}.ccc-native-recent-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:500 13px/17px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}' +
  '.ccc-native-recent-draft{flex:0 0 14px;width:14px;height:14px;background:#e89a6c;-webkit-mask:url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 16 16%27%3E%3Cpath d=%27M11.2 2.3a1.6 1.6 0 0 1 2.3 2.3l-7.9 7.9-3.1.8.8-3.1z%27 fill=%27none%27 stroke=%27black%27 stroke-width=%271.5%27 stroke-linejoin=%27round%27/%3E%3C/svg%3E") center/13px no-repeat;mask:url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 16 16%27%3E%3Cpath d=%27M11.2 2.3a1.6 1.6 0 0 1 2.3 2.3l-7.9 7.9-3.1.8.8-3.1z%27 fill=%27none%27 stroke=%27black%27 stroke-width=%271.5%27 stroke-linejoin=%27round%27/%3E%3C/svg%3E") center/13px no-repeat}.ccc-native-recent-draft[hidden]{display:none}' +
  '.ccc-native-recent-engine{flex:0 0 auto;padding:0 6px;border-radius:999px;color:#f2bd5c;background:color-mix(in srgb,#d9a640 26%,transparent);font:600 10px/16px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}' +
  '.ccc-native-recent-detail{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:400 11px/15px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;opacity:.58}' +
  '.ccc-native-recent-empty{margin:0;padding:18px;text-align:center;font:12px/18px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;opacity:.6}' +
  '@container ccc-native-tabs (max-width:430px){.ccc-native-recent-trigger>span:nth-child(2){display:none}}' +
  '@media(max-width:720px){.ccc-native-recent-menu{left:-4px}}';

export function buildNativeRecentConversationMenuInjectionSource() {
  return [
    updateClaudeStatus,
    updateNativeRecentStatus,
    updateNativeRecentDraft,
    recentNativeConversationRecords,
    openNativeConversationPages,
    installNativeRecentConversationMenu
  ].map((value) => value.toString()).join("\n");
}
