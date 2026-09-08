import { installNativeConversationTabDragging, reorderNativeConversationTabs } from "./native-conversation-tab-drag.mjs";
import {
  advanceNativeTabClickSequence,
  advanceNativeWheelMomentum,
  adjacentNativeConversationTabKey,
  NativeConversationTabState,
  normalizeNativeConversationTab,
  normalizeNativeConversationTabHistory
} from "./native-conversation-tab-state.mjs";

export {
  advanceNativeTabClickSequence,
  advanceNativeWheelMomentum,
  adjacentNativeConversationTabKey,
  NativeConversationTabState,
  normalizeNativeConversationTab,
  normalizeNativeConversationTabHistory
};

export function buildNativeConversationTabsInjectionSource() {
  const clickSequenceSource = advanceNativeTabClickSequence.toString();
  const wheelMomentumSource = advanceNativeWheelMomentum.toString();
  const reorderTabsSource = reorderNativeConversationTabs.toString();
  const dragInstallerSource = installNativeConversationTabDragging.toString();
  return `
  ${clickSequenceSource}
  ${wheelMomentumSource}
  ${reorderTabsSource}
  ${dragInstallerSource}
  function installNativeConversationTabs(options) {
    const VERSION = '2026-09-08.1';
    const ROOT_SELECTOR = '[data-codex-control-console-native-tabs]';
    const STYLE_SELECTOR = '[data-codex-control-console-native-tab-style]';
    const TITLE_HIDDEN_ATTRIBUTE = 'data-codex-control-console-native-title-hidden';
    const STORAGE_KEY = 'codex-control-console.native-tabs.v1';
    const MAX_TABS = 40;
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const previous = window.__codexControlConsoleConversationTabs;
    if (previous?.version === VERSION && document.querySelector(ROOT_SELECTOR)) return previous;
    const renderedTabs = Array.from(document.querySelectorAll(ROOT_SELECTOR + ' .ccc-native-tab[data-tab-key]:not([data-console-tab])')).map((node) => ({ key: node.dataset.tabKey || '', title: node.querySelector('.ccc-native-tab-title')?.textContent || '', active: node.getAttribute('aria-selected') === 'true' }));
    const previousSnapshot = previous?.snapshot?.() || null;
    previous?.destroy?.();
    document.querySelectorAll(ROOT_SELECTOR + ',' + STYLE_SELECTOR).forEach((node) => node.remove());

    let state = { tabs: [], activeKey: 'console', consoleModule: 'board', dismissedLocalKeys: [] };
    let observer = null, renderPending = false, root = null, stableWorkspaceLeft = null, titleTakeoverNodes = new Set();
    let tabClickSequence = {}, wheelAccumulator = 0, wheelMomentum = {};
    const clean = (value, limit) => String(value || '').replace(/[\\u0000-\\u001f\\u007f]/g, '').replace(/\\s+/g, ' ').trim().slice(0, limit);
    const keyFor = (tab) => tab.kind === 'local' ? 'local:' + tab.id.toLowerCase() : tab.kind === 'chatgpt' ? 'chatgpt:' + tab.id.toLowerCase() : 'remote:' + encodeURIComponent(tab.deviceId) + '/' + encodeURIComponent(tab.id);

    function normalizeTab(tab) {
      const kind = tab?.kind === 'remote' ? 'remote' : tab?.kind === 'local' ? 'local' : tab?.kind === 'chatgpt' ? 'chatgpt' : null;
      const id = clean(tab?.id, 160), deviceId = kind === 'remote' ? clean(tab?.deviceId, 120) : 'local';
      if (!kind || !id || !deviceId || (kind !== 'remote' && !UUID.test(id))) return null;
      return { kind, id: kind === 'remote' ? id : id.toLowerCase(), deviceId, title: clean(tab?.title, 160) || '未命名会话', cwd: clean(tab?.cwd, 1024), deviceName: clean(tab?.deviceName, 80) };
    }

    function renderedTab(record) {
      let match = /^local:([0-9a-f-]{36})$/i.exec(record?.key || '');
      if (match) return { kind: 'local', id: match[1], title: record.title };
      match = /^chatgpt:([0-9a-f-]{36})$/i.exec(record?.key || '');
      if (match) return { kind: 'chatgpt', id: match[1], title: record.title };
      match = /^remote:([^/]+)\\/(.+)$/.exec(record?.key || '');
      if (!match) return null;
      try { return { kind: 'remote', deviceId: decodeURIComponent(match[1]), id: decodeURIComponent(match[2]), title: record.title }; } catch { return null; }
    }

    function normalizeHistory(input) {
      const tabs = [], keys = new Set();
      for (const candidate of Array.isArray(input?.tabs) ? input.tabs : []) {
        const tab = normalizeTab(candidate), key = tab ? keyFor(tab) : '';
        if (!tab || keys.has(key)) continue;
        keys.add(key); tabs.push(tab); if (tabs.length >= MAX_TABS) break;
      }
      const activeKey = input?.activeKey === 'console' || keys.has(input?.activeKey) ? input.activeKey : 'console';
      const consoleModule = ['board', 'console', 'sessions', 'context', 'priority', 'zotero'].includes(input?.consoleModule) ? input.consoleModule : 'board';
      const dismissedLocalKeys = [], dismissed = new Set();
      for (const candidate of Array.isArray(input?.dismissedLocalKeys) ? input.dismissedLocalKeys : []) {
        const key = clean(candidate, 50).toLowerCase();
        if (!key.startsWith('local:') || !UUID.test(key.slice(6)) || keys.has(key) || dismissed.has(key)) continue;
        dismissed.add(key); dismissedLocalKeys.push(key); if (dismissedLocalKeys.length >= MAX_TABS) break;
      }
      return { tabs, activeKey, consoleModule, dismissedLocalKeys };
    }

    function readHistory() {
      try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { return null; }
    }

    function snapshot() {
      return { tabs: state.tabs.map((tab) => ({ ...tab })), activeKey: state.activeKey, consoleModule: state.consoleModule, dismissedLocalKeys: [...state.dismissedLocalKeys] };
    }

    function persist() {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot())); } catch {}
    }

    const renderedHistory = renderedTabs.length ? { tabs: renderedTabs.map(renderedTab).filter(Boolean), activeKey: renderedTabs.find((record) => record.active)?.key || 'console' } : null;
    state = normalizeHistory(previousSnapshot || renderedHistory || readHistory());

    function activeTab() {
      return state.activeKey === 'console' ? { kind: 'console', module: state.consoleModule } : state.tabs.find((tab) => keyFor(tab) === state.activeKey) || null;
    }

    function syncNativeTitleTakeover() {
      const workspace = options.workspaceCandidate?.();
      const workspaceRect = workspace?.getBoundingClientRect?.();
      const actionLabels = ['聊天操作', 'Chat actions'];
      const projectPrefixes = ['项目：', 'Project:'];
      const retained = new Set(Array.from(titleTakeoverNodes).filter((node) => node.isConnected));
      const isVisibleTopButton = (button) => {
        const bounds = button.getBoundingClientRect(), presentation = getComputedStyle(button);
        return bounds.width > 0 && bounds.height > 0 && bounds.top < 42 && presentation.display !== 'none' && presentation.visibility !== 'hidden' && presentation.pointerEvents !== 'none';
      };
      const chatAction = Array.from(document.querySelectorAll('button[aria-label]')).find((button) => {
        return actionLabels.includes(clean(button.getAttribute('aria-label'), 80)) && isVisibleTopButton(button);
      });
      if (!chatAction) {
        titleTakeoverNodes = retained;
        return;
      }
      const next = new Set();
      if (chatAction && workspaceRect?.width > 260) {
        const actionRect = chatAction.getBoundingClientRect();
        const buttons = Array.from(document.querySelectorAll('button')).filter((button) => !root?.contains(button) && isVisibleTopButton(button));
        const project = buttons.find((button) => {
          const label = clean(button.getAttribute('aria-label'), 160), bounds = button.getBoundingClientRect();
          return projectPrefixes.some((prefix) => label.startsWith(prefix)) && bounds.left >= workspaceRect.left + 4 && bounds.right <= actionRect.left + 1;
        });
        const titleLeft = project?.getBoundingClientRect().right || workspaceRect.left + 4;
        const title = buttons.filter((button) => {
          const bounds = button.getBoundingClientRect();
          return !button.hasAttribute('aria-label') && bounds.left >= titleLeft - 1 && bounds.right <= actionRect.left + 1;
        }).sort((left, right) => right.getBoundingClientRect().width - left.getBoundingClientRect().width)[0];
        [project, title, chatAction].filter(Boolean).forEach((button) => next.add(button));
      }
      document.querySelectorAll('[' + TITLE_HIDDEN_ATTRIBUTE + ']').forEach((node) => {
        if (!next.has(node)) node.removeAttribute(TITLE_HIDDEN_ATTRIBUTE);
      });
      next.forEach((node) => node.setAttribute(TITLE_HIDDEN_ATTRIBUTE, ''));
      titleTakeoverNodes = next;
    }

    function position() {
      if (!root) return;
      syncNativeTitleTakeover();
      const candidate = options.workspaceCandidate?.();
      const rect = candidate?.getBoundingClientRect?.();
      const topControls = Array.from(document.querySelectorAll('button,a,[role="button"],[role="link"]')).filter((element) => {
        if (root.contains(element)) return false;
        const bounds = element.getBoundingClientRect(), style = getComputedStyle(element);
        return bounds.width > 0 && bounds.height > 0 && bounds.top < 42 && bounds.bottom > 0 && bounds.right < innerWidth * .62 && style.visibility !== 'hidden' && style.pointerEvents !== 'none';
      });
      const leftControlEdge = topControls.reduce((edge, element) => Math.max(edge, element.getBoundingClientRect().right), 0);
      if (rect?.width > 260) stableWorkspaceLeft = Math.max(76, Math.round(rect.left + 8));
      const left = stableWorkspaceLeft ?? Math.max(236, Math.round(leftControlEdge + 8));
      const right = rect?.width > 260 ? Math.max(152, Math.round(innerWidth - rect.right + 152)) : 152;
      const safeRight = Math.min(right, Math.max(60, innerWidth - 300));
      root.style.left = Math.min(left, Math.max(76, innerWidth - safeRight - 180)) + 'px';
      root.style.right = safeRight + 'px';
    }

    function tabButton(tab) {
      const key = keyFor(tab), item = document.createElement('div');
      item.className = 'ccc-native-tab'; item.dataset.tabKey = key; item.setAttribute('role', 'tab');
      item.draggable = true;
      item.setAttribute('aria-selected', String(state.activeKey === key)); item.tabIndex = state.activeKey === key ? 0 : -1;
      item.title = tab.title + (tab.kind === 'remote' && tab.deviceName ? '\\n' + tab.deviceName : '');
      const dot = document.createElement('span'); dot.className = 'ccc-native-tab-dot'; dot.dataset.kind = tab.kind; dot.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span'); label.className = 'ccc-native-tab-title'; label.textContent = tab.title;
      const close = document.createElement('button'); close.type = 'button'; close.draggable = false; close.className = 'ccc-native-tab-close'; close.dataset.closeKey = key; close.textContent = '×'; close.setAttribute('aria-label', '关闭标签：' + tab.title);
      item.append(dot, label, close); return item;
    }

    function render() {
      if (!root) return;
      persist();
      const consoleTab = root.querySelector('[data-console-tab]');
      consoleTab.setAttribute('aria-selected', String(state.activeKey === 'console')); consoleTab.tabIndex = state.activeKey === 'console' ? 0 : -1;
      const list = root.querySelector('[data-native-tab-list]'); list.replaceChildren(...state.tabs.map(tabButton));
      position();
      (state.activeKey === 'console' ? consoleTab : list.querySelector('[aria-selected="true"]'))?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }

    function open(tab, activate = true, explicitView = false) {
      const value = normalizeTab(tab); if (!value) return false;
      const key = keyFor(value), index = state.tabs.findIndex((item) => keyFor(item) === key);
      const dismissedIndex = value.kind === 'local' ? (state.dismissedLocalKeys || []).indexOf(key) : -1;
      if (dismissedIndex >= 0 && !explicitView) return false;
      if (dismissedIndex >= 0) state.dismissedLocalKeys.splice(dismissedIndex, 1);
      const same = index >= 0 && JSON.stringify(state.tabs[index]) === JSON.stringify(value);
      if (index < 0) state.tabs.push(value); else state.tabs[index] = value;
      const changedActive = activate && state.activeKey !== key; if (activate) state.activeKey = key;
      if (index < 0 || !same || changedActive) render();
      if (activate && (changedActive || explicitView) && value.kind === 'local') window.__codexControlConsoleAttentionConversations?.view?.(value);
      return true;
    }

    function showConsole(module, activate = true) {
      if (['board', 'console', 'sessions', 'context', 'priority', 'zotero'].includes(module)) state.consoleModule = module;
      if (activate && state.activeKey !== 'console') { state.activeKey = 'console'; render(); }
      else persist();
      return true;
    }

    function activate(key) {
      const tab = key === 'console' ? { kind: 'console', module: state.consoleModule } : state.tabs.find((item) => keyFor(item) === key);
      if (!tab) return; state.activeKey = key; render();
      if (tab.kind === 'console') options.openConsole?.(tab.module);
      else if (tab.kind === 'local') { options.openLocal?.(tab); window.__codexControlConsoleAttentionConversations?.view?.(tab); }
      else if (tab.kind === 'chatgpt') options.openChatgpt?.(tab);
      else options.openRemote?.(tab);
    }

    function adjacentKey(direction) {
      const keys = ['console', ...state.tabs.map(keyFor)], index = Math.max(0, keys.indexOf(state.activeKey));
      return keys[(index + (direction < 0 ? -1 : 1) + keys.length) % keys.length] || 'console';
    }

    function close(key) {
      const index = state.tabs.findIndex((item) => keyFor(item) === key); if (index < 0) return;
      const closing = state.tabs[index], wasActive = state.activeKey === key;
      if (closing.kind === 'local') state.dismissedLocalKeys = [...state.dismissedLocalKeys.filter((value) => value !== key), key].slice(-MAX_TABS);
      state.tabs.splice(index, 1);
      if (!wasActive) return render();
      const next = state.tabs[index] || state.tabs[index - 1]; state.activeKey = next ? keyFor(next) : 'console'; activate(state.activeKey);
    }

    function localTitle(row) {
      const nativeTitle = row.getAttribute('data-app-action-sidebar-thread-title');
      const trigger = row.querySelector('[data-thread-title="true"],[data-thread-title-trigger]');
      const candidates = trigger ? [trigger] : Array.from(row.querySelectorAll('.truncate, span')).filter((node) => !node.closest('[data-codex-control-console-sidebar-labels]'));
      return clean(nativeTitle || candidates.find((node) => clean(node.textContent, 160))?.textContent || row.getAttribute('aria-label'), 160) || '本地会话';
    }

    function syncSelectedLocal(row) {
      if (document.querySelector('[data-codex-control-console-workspace]')) return;
      const selected = row?.matches?.('[data-app-action-sidebar-thread-selected="true"]') ? row : document.querySelector('[data-app-action-sidebar-thread-id^="local:"][data-app-action-sidebar-thread-selected="true"]');
      const raw = selected?.getAttribute('data-app-action-sidebar-thread-id') || '', id = raw.startsWith('local:') ? raw.slice(6) : '';
      if (UUID.test(id)) open({ kind: 'local', id, title: localTitle(selected) }, true, Boolean(row));
    }

    function chatgptTab(row) {
      if (!row || row.getAttribute('data-codex-control-console-chat-classification') === 'cloud-work') return null;
      const key = row.getAttribute('data-sidebar-chatgpt-conversation-key') || row.getAttribute('data-codex-control-console-ordinary-chat-row') || '';
      const match = /^chatgpt:conversation:([0-9a-f-]{36})$/i.exec(key);
      if (!match || !UUID.test(match[1])) return null;
      const title = row.querySelector?.('[data-thread-title="true"]')?.textContent || row.getAttribute('aria-label') || row.textContent;
      return { kind: 'chatgpt', id: match[1], title: clean(title, 160) || 'ChatGPT 会话' };
    }

    function scheduleSync() {
      if (renderPending) return; renderPending = true;
      requestAnimationFrame(() => { renderPending = false; syncSelectedLocal(); position(); });
    }

    const style = document.createElement('style'); style.setAttribute('data-codex-control-console-native-tab-style', '');
    style.textContent = '[' + TITLE_HIDDEN_ATTRIBUTE + ']{display:none!important}' + ROOT_SELECTOR + '{position:fixed;top:5px;z-index:2147482999;display:flex;height:34px;min-width:0;align-items:center;gap:3px;overflow:hidden;border:1px solid color-mix(in srgb,currentColor 13%,transparent);border-radius:10px;padding:3px;background:var(--color-background-primary,#202022);color:var(--color-text,#eee);box-shadow:0 2px 12px rgba(0,0,0,.08);backdrop-filter:blur(18px);-webkit-app-region:no-drag;app-region:no-drag}' +
      ROOT_SELECTOR + ' .ccc-native-tab-list{display:flex;min-width:0;flex:1;gap:2px;overflow-x:auto;scrollbar-width:none}' + ROOT_SELECTOR + ' .ccc-native-tab-list::-webkit-scrollbar{display:none}' +
      ROOT_SELECTOR + ' .ccc-native-tab{display:flex;height:26px;min-width:112px;max-width:220px;flex:0 1 190px;align-items:center;gap:7px;border:0;border-radius:7px;padding:0 6px 0 9px;background:transparent;color:inherit;font:500 12px/18px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer}' +
      ROOT_SELECTOR + ' .ccc-native-tab:hover{background:color-mix(in srgb,currentColor 8%,transparent)}' + ROOT_SELECTOR + ' .ccc-native-tab[aria-selected="true"]{background:color-mix(in srgb,currentColor 13%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,currentColor 8%,transparent)}' +
      ROOT_SELECTOR + ' .ccc-native-tab[draggable="true"]{cursor:grab}' + ROOT_SELECTOR + ' .ccc-native-tab[data-dragging]{cursor:grabbing;opacity:.52}' +
      ROOT_SELECTOR + ' .ccc-native-tab[data-drop-position="before"]{box-shadow:inset 3px 0 0 #7aa2ff}' + ROOT_SELECTOR + ' .ccc-native-tab[data-drop-position="after"]{box-shadow:inset -3px 0 0 #7aa2ff}' +
      ROOT_SELECTOR + ' .ccc-native-console{min-width:88px;max-width:110px;flex-basis:100px}' + ROOT_SELECTOR + ' .ccc-native-tab-dot{width:7px;height:7px;flex:0 0 7px;border-radius:50%;background:#7d8ca8}' + ROOT_SELECTOR + ' .ccc-native-tab-dot[data-kind="chatgpt"]{background:#8b74d6}' + ROOT_SELECTOR + ' .ccc-native-tab-dot[data-kind="remote"]{background:#42a575}' +
      ROOT_SELECTOR + ' .ccc-native-tab-title{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' + ROOT_SELECTOR + ' .ccc-native-tab-close{display:grid;width:18px;height:18px;flex:0 0 18px;place-items:center;border:0;border-radius:5px;padding:0;background:transparent;color:inherit;font:16px/18px inherit;cursor:pointer;opacity:.62}' + ROOT_SELECTOR + ' .ccc-native-tab-close:hover{background:color-mix(in srgb,currentColor 12%,transparent);opacity:1}' +
      '@media(max-width:720px){' + ROOT_SELECTOR + ' .ccc-native-console{min-width:76px;flex-basis:82px}' + ROOT_SELECTOR + ' .ccc-native-tab{min-width:104px;flex-basis:150px}}';
    document.head.append(style);

    root = document.createElement('nav'); root.setAttribute('data-codex-control-console-native-tabs', ''); root.setAttribute('aria-label', '已打开会话');
    const consoleTab = document.createElement('button'); consoleTab.type = 'button'; consoleTab.className = 'ccc-native-tab ccc-native-console'; consoleTab.dataset.consoleTab = ''; consoleTab.dataset.tabKey = 'console'; consoleTab.setAttribute('role', 'tab');
    const mark = document.createElement('span'); mark.className = 'ccc-native-tab-dot'; mark.setAttribute('aria-hidden', 'true');
    const consoleLabel = document.createElement('span'); consoleLabel.className = 'ccc-native-tab-title'; consoleLabel.textContent = '控制台'; consoleTab.append(mark, consoleLabel);
    const list = document.createElement('div'); list.className = 'ccc-native-tab-list'; list.dataset.nativeTabList = ''; list.setAttribute('role', 'tablist');
    root.append(consoleTab, list); document.body.append(root);
    const dragController = installNativeConversationTabDragging({ root, state, keyFor, render });

    root.addEventListener('click', (event) => { const closeButton = event.target.closest('[data-close-key]'); if (closeButton) { tabClickSequence = {}; event.stopPropagation(); close(closeButton.dataset.closeKey); return; } const tab = event.target.closest('[data-tab-key]'); if (!tab) return; tabClickSequence = advanceNativeTabClickSequence(tabClickSequence, tab.dataset.tabKey, performance.now()); if (tabClickSequence.close) { event.preventDefault(); close(tab.dataset.tabKey); return; } activate(tab.dataset.tabKey); });
    root.addEventListener('wheel', (event) => {
      if (!event.deltaY || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? innerHeight : 1);
      wheelMomentum = advanceNativeWheelMomentum(wheelMomentum, delta, performance.now());
      if (wheelMomentum.resetAccumulator) wheelAccumulator = 0;
      if (wheelMomentum.ignoring) return;
      if (wheelAccumulator && Math.sign(wheelAccumulator) !== Math.sign(delta)) wheelAccumulator = 0;
      wheelAccumulator += delta;
      if (Math.abs(wheelAccumulator) < 32) return;
      const next = adjacentKey(-Math.sign(wheelAccumulator));
      wheelAccumulator = 0;
      if (next !== state.activeKey) activate(next);
    }, { passive: false });
    root.addEventListener('keydown', (event) => { if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return; const tabs = [consoleTab, ...list.querySelectorAll('[role="tab"]')], index = tabs.indexOf(event.target.closest('[role="tab"]')); if (index < 0) return; event.preventDefault(); const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length; tabs[nextIndex].focus(); activate(tabs[nextIndex].dataset.tabKey); });
    const nativeClick = (event) => {
      const localRow = event.target?.closest?.('[data-app-action-sidebar-thread-id^="local:"]');
      if (localRow) setTimeout(() => syncSelectedLocal(localRow), 0);
      const chatRow = event.target?.closest?.('[data-sidebar-chatgpt-conversation-key],[data-codex-control-console-ordinary-chat-row]');
      const chatTab = chatgptTab(chatRow);
      if (chatTab) setTimeout(() => open(chatTab, true), 0);
    };
    document.addEventListener('click', nativeClick, true); window.addEventListener('resize', position);
    observer = new MutationObserver((records) => { if (records.every((record) => root.contains(record.target))) return; position(); scheduleSync(); });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-app-action-sidebar-thread-id', 'data-app-action-sidebar-thread-selected', 'data-app-action-sidebar-thread-title'] });

    const controller = { version: VERSION, openLocal: (tab) => open({ ...tab, kind: 'local' }, true, true), openChatgpt: (tab) => open({ ...tab, kind: 'chatgpt' }), openRemote: (tab) => open({ ...tab, kind: 'remote' }), showConsole, active: activeTab, snapshot, reorder: dragController.reorder, destroy() { observer?.disconnect(); dragController.destroy(); document.removeEventListener('click', nativeClick, true); window.removeEventListener('resize', position); document.querySelectorAll('[' + TITLE_HIDDEN_ATTRIBUTE + ']').forEach((node) => node.removeAttribute(TITLE_HIDDEN_ATTRIBUTE)); titleTakeoverNodes.clear(); root?.remove(); style.remove(); } };
    render(); scheduleSync(); return controller;
  }
  `;
}
