import { createConversationShortcutLayout } from './native-conversation-shortcut-layout.mjs';
import { buildNativeLocalConversationSyncSource, resolveNativeLocalConversationId } from './native-conversation-route-sync.mjs';
import { buildNativeConversationTabTitlePolicySource } from './native-conversation-tab-titles.mjs';
import { buildNativeConversationTabTransitionSource } from './native-conversation-tab-transition.mjs';
import { createNativeLatestNavigation } from './native-conversation-latest-navigation.mjs';
import { buildNativeConversationTabStyle } from './native-conversation-tab-style.mjs';
import { buildNativeConversationWindowInjectionSource, NATIVE_CONVERSATION_WINDOW_STYLE } from "./native-conversation-window.mjs";
import { buildNativeRecentConversationMenuInjectionSource, NATIVE_RECENT_CONVERSATION_STYLE } from "./native-recent-conversations.mjs";
import { buildNativeRecentSentMenuInjectionSource } from "./native-recent-sent-conversations.mjs";
import { buildNativeTerminalTabSource } from './native-terminal-tabs.mjs';
import { normalizeNativeConversationTabWheelDirection } from "./native-conversation-tab-preferences.mjs";
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
  normalizeNativeConversationTabHistory,
  resolveNativeLocalConversationId
};

export function buildNativeConversationTabsInjectionSource() {
  const wheelDirectionSource = normalizeNativeConversationTabWheelDirection.toString();
  const titlePolicySource = buildNativeConversationTabTitlePolicySource();
  return `
  ${createConversationShortcutLayout.toString()}
  ${buildNativeLocalConversationSyncSource()}
  ${wheelDirectionSource}
  ${titlePolicySource}
  ${buildNativeConversationWindowInjectionSource()}
  ${buildNativeRecentConversationMenuInjectionSource()}
  ${buildNativeRecentSentMenuInjectionSource()}
  ${buildNativeConversationTabTransitionSource()}
  ${createNativeLatestNavigation.toString()}
  ${buildNativeConversationTabStyle.toString()}
  ${buildNativeTerminalTabSource()}
  function installNativeConversationTabs(options) {
    const VERSION = '2026-09-28.terminal-shortcuts';
    const modules = ['board', 'console', 'sessions', 'context', 'priority', 'projects', 'conversations', 'zotero'];
    const ROOT_SELECTOR = '[data-codex-control-console-native-tabs]';
    const STYLE_SELECTOR = '[data-codex-control-console-native-tab-style]';
    const TITLE_HIDDEN_ATTRIBUTE = 'data-codex-control-console-native-title-hidden';
    const STORAGE_KEY = 'codex-control-console.native-tabs.v1';
    const MAX_TABS = 40;
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const previous = window.__codexControlConsoleConversationTabs;
    if (previous?.version === VERSION && document.querySelector('[data-codex-control-console-conversation-shortcuts]')) { previous.updateOptions?.(options); return previous; }
    const renderedTabs = Array.from(document.querySelectorAll(ROOT_SELECTOR + ' .ccc-native-tab[data-tab-key]:not([data-console-tab])')).map((node) => ({ key: node.dataset.tabKey || '', title: node.querySelector('.ccc-native-tab-title')?.textContent || '', active: node.getAttribute('aria-selected') === 'true' }));
    const previousSnapshot = previous?.snapshot?.() || null;
    previous?.destroy?.();
    document.querySelectorAll('[data-ccc-native-page-tab-inset],[' + TITLE_HIDDEN_ATTRIBUTE + ']').forEach(node => { node.removeAttribute('data-ccc-native-page-tab-inset'); node.removeAttribute(TITLE_HIDDEN_ATTRIBUTE); });
    document.querySelectorAll(ROOT_SELECTOR + ',' + STYLE_SELECTOR).forEach((node) => node.remove());

    let state = { tabs: [], activeKey: 'console', consoleModule: 'board', wheelDirection: 'standard', dismissedLocalKeys: [] };
    let observer = null, renderPending = false, renderTimer = null, lastSyncAt = 0, root = null, shortcutRoot = null, transition = null, recentMenu = null;
    let recentSentMenu = null, latestNavigation = createNativeLatestNavigation(document, window);
    const clean = (value, limit) => String(value || '').replace(/[\\u0000-\\u001f\\u007f]/g, '').replace(/\\s+/g, ' ').trim().slice(0, limit);
    const keyFor = (tab) => tab.kind === 'local' ? 'local:' + tab.id.toLowerCase() : tab.kind === 'chatgpt' ? 'chatgpt:' + tab.id.toLowerCase() : tab.kind + ':' + encodeURIComponent(tab.deviceId) + '/' + encodeURIComponent(tab.id);
    const normalizeTab = createNativeConversationTabNormalizer(localStorage, clean, UUID);

    function renderedTab(record) {
      let match = /^local:([0-9a-f-]{36})$/i.exec(record?.key || '');
      if (match) return { kind: 'local', id: match[1], title: record.title };
      match = /^chatgpt:([0-9a-f-]{36})$/i.exec(record?.key || '');
      if (match) return { kind: 'chatgpt', id: match[1], title: record.title };
      match = /^(remote|terminal):([^/]+)\\/(.+)$/.exec(record?.key || '');
      if (!match) return null;
      try { return { kind: match[1], deviceId: decodeURIComponent(match[2]), id: decodeURIComponent(match[3]), title: record.title }; } catch { return null; }
    }

    function normalizeHistory(input) {
      const tabs = [], keys = new Set();
      for (const candidate of Array.isArray(input?.tabs) ? input.tabs : []) {
        const tab = normalizeTab(candidate), key = tab ? keyFor(tab) : '';
        if (!tab || keys.has(key)) continue;
        keys.add(key); tabs.push(tab); if (tabs.length >= MAX_TABS) break;
      }
      const activeKey = input?.activeKey === 'console' || keys.has(input?.activeKey) ? input.activeKey : 'console';
      const consoleModule = modules.includes(input?.consoleModule) ? input.consoleModule : 'board';
      const wheelDirection = normalizeNativeConversationTabWheelDirection(input?.wheelDirection);
      const dismissedLocalKeys = [], dismissed = new Set();
      for (const candidate of Array.isArray(input?.dismissedLocalKeys) ? input.dismissedLocalKeys : []) {
        const key = clean(candidate, 50).toLowerCase();
        if (!key.startsWith('local:') || !UUID.test(key.slice(6)) || keys.has(key) || dismissed.has(key)) continue;
        dismissed.add(key); dismissedLocalKeys.push(key); if (dismissedLocalKeys.length >= MAX_TABS) break;
      }
      return { tabs, activeKey, consoleModule, wheelDirection, dismissedLocalKeys };
    }

    function readHistory() {
      try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { return null; }
    }

    function snapshot() {
      return { tabs: state.tabs.map((tab) => ({ ...tab })), activeKey: state.activeKey, consoleModule: state.consoleModule, wheelDirection: state.wheelDirection, dismissedLocalKeys: [...state.dismissedLocalKeys] };
    }

    function persist() {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot())); } catch {}
    }

    const renderedHistory = renderedTabs.length ? { tabs: renderedTabs.map(renderedTab).filter(Boolean), activeKey: renderedTabs.find((record) => record.active)?.key || 'console' } : null;
    state = normalizeHistory(previousSnapshot || renderedHistory || readHistory());

    function activeTab() {
      return state.activeKey === 'console' ? { kind: 'console', module: state.consoleModule } : state.tabs.find((tab) => keyFor(tab) === state.activeKey) || null;
    }

    function position() { shortcutLayout.update(); }

    function render() {
      persist();
      recentMenu?.render();
      recentSentMenu?.render();
      position();
    }

    function open(tab, activate = true, explicitView = false) {
      let value = normalizeTab(tab); if (!value) return false;
      const key = keyFor(value), index = state.tabs.findIndex((item) => keyFor(item) === key);
      const dismissedIndex = value.kind === 'local' ? (state.dismissedLocalKeys || []).indexOf(key) : -1;
      if (dismissedIndex >= 0 && !explicitView) return false;
      if (dismissedIndex >= 0) state.dismissedLocalKeys.splice(dismissedIndex, 1);
      const same = index >= 0 && JSON.stringify(state.tabs[index]) === JSON.stringify(value);
      if (index >= 0) state.tabs.splice(index, 1);
      state.tabs.push(value);
      const changedActive = activate && state.activeKey !== key; if (activate) state.activeKey = key;
      if (index < 0 || !same || changedActive) render();
      if (activate && (changedActive || explicitView) && value.kind === 'local') window.__codexControlConsoleAttentionConversations?.view?.(value);
      return true;
    }

    function showConsole(module, activate = true) {
      if (modules.includes(module)) state.consoleModule = module;
      if (activate && state.activeKey !== 'console') { state.activeKey = 'console'; render(); }
      else persist();
      return true;
    }

    function request(tab, navigate = false) {
      const value = normalizeTab({ ...tab, kind: 'local' });
      if (!value) return false;
      const key = keyFor(value);
      open(value, false, true);
      transition.request(key);
      if (navigate) latestNavigation.request(value.id);
      if (navigate) options.openLocal?.(value);
      setTimeout(syncLocal, 0);
      return true;
    }

    function activate(key) {
      const tab = key === 'console' ? { kind: 'console', module: state.consoleModule } : state.tabs.find((item) => keyFor(item) === key);
      if (!tab) return;
      if (tab.kind === 'local') { request(tab, true); return; }
      latestNavigation.cancel();
      transition.clear();
      state.activeKey = key; render();
      if (tab.kind === 'console') options.openConsole?.(tab.module);
      else if (tab.kind === 'chatgpt') options.openChatgpt?.(tab);
      else if (tab.kind === 'terminal') options.openTerminal?.(tab);
      else options.openRemote?.(tab);
    }

    function adjacentKey(direction) {
      const keys = ['console', ...state.tabs.map(keyFor)], index = Math.max(0, keys.indexOf(state.activeKey));
      return keys[(index + (direction < 0 ? -1 : 1) + keys.length) % keys.length] || 'console';
    }

    function close(key) {
      const index = state.tabs.findIndex((item) => keyFor(item) === key); if (index < 0) return;
      const closing = state.tabs[index], wasActive = state.activeKey === key, q = transition.matches(key);
      if (q) transition.clear();
      if (closing.kind === 'local') state.dismissedLocalKeys = [...state.dismissedLocalKeys.filter((value) => value !== key), key].slice(-MAX_TABS);
      state.tabs.splice(index, 1);
      if (!wasActive) { render(); if (q) activate(state.activeKey); return; }
      state.activeKey = 'console';
      render(); activate('console');
    }

    function syncLocal() {
      if (document.querySelector('[data-codex-control-console-workspace]')) return;
      const mounted = readNativeLocalConversation(document, state, clean);
      if (!mounted) return;
      const key = 'local:' + mounted.id, explicit = transition.matches(key);
      if (transition.isPending() && !explicit) return;
      if (open({ kind: 'local', ...mounted }, true, explicit) && explicit) {
        transition.clear();
      }
    }

    function chatgptTab(row) {
      if (!row || row.getAttribute('data-codex-control-console-chat-classification') === 'cloud-work') return null;
      const key = row.getAttribute('data-sidebar-chatgpt-conversation-key') || row.getAttribute('data-codex-control-console-ordinary-chat-row') || '';
      const match = /^chatgpt:conversation:([0-9a-f-]{36})$/i.exec(key);
      if (!match || !UUID.test(match[1])) return null;
      const title = row.querySelector?.('[data-thread-title="true"]')?.textContent || row.getAttribute('aria-label') || row.textContent;
      return { kind: 'chatgpt', id: match[1], title: clean(title, 160) || 'ChatGPT 会话' };
    }

    function scheduleSync(urgent = false, forceTitleScan = false) {
      if (renderPending) {
        if (!urgent || !renderTimer) return;
        clearTimeout(renderTimer); renderTimer = null; renderPending = false;
      }
      renderPending = true;
      const interval = urgent ? 0 : 320;
      const delay = Math.max(0, interval - (performance.now() - lastSyncAt));
      const queue = () => requestAnimationFrame(() => { renderPending = false; renderTimer = null; lastSyncAt = performance.now(); syncLocal(); position(forceTitleScan); });
      if (delay > 0) renderTimer = setTimeout(queue, delay); else queue();
    }

    const style = document.createElement('style'); style.setAttribute('data-codex-control-console-native-tab-style', '');
    style.textContent = buildNativeConversationTabStyle(ROOT_SELECTOR, TITLE_HIDDEN_ATTRIBUTE, nativeConversationTabTransitionStyle(ROOT_SELECTOR), ${JSON.stringify(NATIVE_CONVERSATION_WINDOW_STYLE + NATIVE_RECENT_CONVERSATION_STYLE)});
    document.head.append(style);

    // Detached transition target: navigation state remains, retired tab DOM does not.
    root = document.createElement('div');
    shortcutRoot = document.createElement('div'); shortcutRoot.setAttribute('data-codex-control-console-conversation-shortcuts', ''); shortcutRoot.hidden = true; document.body.append(shortcutRoot);
    const shortcutLayout = createConversationShortcutLayout(document, window, shortcutRoot);
    recentMenu = installNativeRecentConversationMenu({ documentRef: document, root: shortcutRoot, state, keyFor, activate, openWindow: options.openWindow });
    recentSentMenu = installNativeRecentSentMenu({ documentRef: document, root: shortcutRoot, state, keyFor, openLocal: (tab) => request(tab, true), openTerminal: (tab) => window.__codexControlConsoleOpenTerminalConversation?.(window.__cccTerminalConversations?.records?.().find((record) => record.id === tab.id) || { provider: 'terminal', conversationId: tab.id, deviceId: tab.deviceId }), openWindow: options.openWindow, readSnapshot: () => window.__codexControlConsoleRecentSentSnapshot, readTerminal: () => window.__cccTerminalConversations?.records?.() || [] });
    transition = createNativeConversationTabTransition(root, () => { render(); syncLocal(); });

    const nativeClick = (event) => {
      const localRow = event.target?.closest?.('[data-app-action-sidebar-thread-id^="local:"]');
      if (localRow) {
        const raw = localRow.getAttribute('data-app-action-sidebar-thread-id') || '', id = raw.startsWith('local:') ? raw.slice(6) : '';
        if (UUID.test(id)) { latestNavigation.request(id); request({ id, title: nativeLocalTitle(localRow, clean) }); }
      }
      const chatRow = event.target?.closest?.('[data-sidebar-chatgpt-conversation-key],[data-codex-control-console-ordinary-chat-row]');
      const chatTab = chatgptTab(chatRow);
      if (chatTab) { latestNavigation.cancel(); setTimeout(() => open(chatTab, true), 0); }
    };
    document.addEventListener('click', nativeClick, true);
    observer = new MutationObserver((records) => { if (records.every((record) => root.contains(record.target))) return; scheduleSync(routeChanged(records)); });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-app-action-sidebar-thread-id', 'data-app-action-sidebar-thread-selected', 'data-app-action-sidebar-thread-title', 'data-above-composer-conversation-id', 'open', 'hidden', 'aria-hidden', 'aria-expanded', 'data-state'] });

    const onResize = () => scheduleSync(true, true);
    window.addEventListener('resize', onResize);
    const terminalTabs = createNativeTerminalTabController({ state, keyFor, normalizeTab, open, close, render });
    const controller = { ...terminalTabs, version: VERSION, relayout: () => position(), updateOptions(next) { options = next; }, openLocal: request, openChatgpt: (tab) => open({ ...tab, kind: 'chatgpt' }), openRemote: (tab) => open({ ...tab, kind: 'remote' }), showConsole, active: activeTab, snapshot, latestNavigation: latestNavigation.snapshot, updateRecentSent: () => { recentMenu?.render(); recentSentMenu?.render(); }, destroy() { latestNavigation.cancel(); shortcutLayout.dispose(); observer?.disconnect(); transition.dispose(); recentMenu?.destroy(); recentSentMenu?.destroy(); if (renderTimer) clearTimeout(renderTimer); document.removeEventListener('click', nativeClick, true); window.removeEventListener('resize', onResize); document.querySelectorAll('[' + TITLE_HIDDEN_ATTRIBUTE + ']').forEach((node) => node.removeAttribute(TITLE_HIDDEN_ATTRIBUTE)); shortcutRoot?.remove(); root?.remove(); style.remove(); } };
    render(); scheduleSync(true, true); return controller;
  }
  `;
}
