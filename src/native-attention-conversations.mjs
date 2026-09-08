import { createConversationViewHistory } from './conversation-view-history.mjs';

export function installNativeAttentionConversations(createHistory = createConversationViewHistory) {
  const VERSION = '2026-09-07.1';
  if (window.__codexControlConsoleAttentionConversations?.version === VERSION) return;
  window.__codexControlConsoleAttentionConversations?.dispose();
  const ROOT = 'data-codex-control-console-attention-conversations';
  const STORAGE = 'codex-control-console.attention-conversations.expanded.v1';
  const HISTORY = 'codex-control-console.conversation-view-history.v1';
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem(HISTORY) || '[]'); } catch { /* optional */ }
  const history = createHistory(saved);
  document.querySelectorAll('[' + ROOT + ']').forEach(node => node.remove());
  let expanded = {};
  try { expanded = JSON.parse(localStorage.getItem(STORAGE) || '{}') || {}; } catch { /* optional presentation state */ }
  let snapshot = { items: [], stale: true }; let roots = []; let signature = ''; let pending = false; let disposed = false;
  function node(tag, classes, text) {
    const element = document.createElement(tag); element.className = classes || '';
    if (text != null) element.textContent = text;
    return element;
  }
  function arrow(source, open) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', source?.getAttribute('viewBox') || '0 0 20 21');
    svg.setAttribute('width', '20'); svg.setAttribute('height', '21');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'icon-disclosure shrink-0 transition-transform opacity-0 group-hover/section-toggle:opacity-100 group-focus-visible/section-toggle:opacity-100 sidebar-hover-icon-tint ' + (open ? 'rotate-0' : '-rotate-90'));
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', source?.querySelector('path')?.getAttribute('d') || 'M4 7.7 10 13.7 16 7.7 15 6.7 10 11.7 5 6.7Z');
    path.setAttribute('fill', 'currentColor'); svg.append(path); return svg;
  }
  function render() {
    if (disposed) return;
    const native = document.querySelector('section[data-app-action-sidebar-section-heading="Projects"]');
    const parent = native?.parentElement?.parentElement;
    if (!parent) return;
    const heading = native.querySelector('[class*="nav-section-title"]');
    const toggle = native.querySelector('[data-app-action-sidebar-section-toggle]');
    const thread = document.querySelector('[data-app-action-sidebar-thread-row]');
    const classes = [native.className, heading?.className, heading?.firstElementChild?.className, toggle?.className, thread?.className];
    const nextSignature = JSON.stringify([snapshot, expanded, classes, history.list()]);
    if (roots.length === 4 && roots.every(root => root.parentElement === parent) && signature === nextSignature) return;
    signature = nextSignature;
    const next = [];
    for (const [key, title, order] of [['review', '等待查看', 5], ['active', '进行中', 6], ['codex', 'codex委派', 7], ['history', '查看历史', 8]]) {
      const items = key === 'history' ? history.list() : snapshot.items.filter(item => item.section === key && (key !== 'review' || !history.hasViewed(item)));
      const open = expanded[key] !== false;
      const root = node('div'); root.setAttribute(ROOT, key); root.style.order = String(order);
      root.setAttribute('draggable', 'false');
      for (const type of ['dragstart', 'dragenter', 'dragover', 'drop']) root.addEventListener(type, event => {
        event.preventDefault(); event.stopPropagation(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
      }, true);
      root.addEventListener('pointerdown', event => event.stopPropagation());
      const section = node('section', classes[0] || 'relative px-row-x'); section.setAttribute('aria-label', title);
      const header = node('div', classes[1] || 'group/nav-section-title flex items-center justify-between gap-2 ps-2');
      const text = node('div', classes[2] || 'min-w-0 flex-1 text-base font-medium text-tertiary opacity-75');
      const inner = node('div', 'flex min-w-0 flex-1');
      const button = node('button', classes[3] || 'group/section-toggle flex min-w-0 flex-1 items-center gap-1 text-start');
      button.type = 'button'; button.setAttribute('aria-expanded', String(open)); button.setAttribute('draggable', 'false');
      button.setAttribute('data-attention-toggle', key); button.title = '自动分类，不支持拖入或拖出';
      button.append(node('span', 'min-w-0 truncate', title), arrow(toggle?.querySelector('svg'), open));
      button.addEventListener('click', () => {
        expanded[key] = !open;
        try { localStorage.setItem(STORAGE, JSON.stringify(expanded)); } catch { /* optional */ }
        render();
      });
      inner.append(button); text.append(inner); header.append(text, node('span', 'me-2 shrink-0 text-sm text-tertiary', String(items.length)));
      section.append(header);
      if (open) {
        const list = node('div', 'flex flex-col'); list.setAttribute('role', 'list');
        if (snapshot.stale && key !== 'history') list.append(node('div', 'px-2 py-1 text-sm text-tertiary', '状态暂未更新'));
        else if (!items.length) list.append(node('div', 'px-2 py-2 text-base text-tertiary', key === 'review' ? '暂无等待查看的会话' : key === 'active' ? '暂无进行中的会话' : key === 'codex' ? '暂无 codex委派' : '暂无查看历史'));
        for (const item of items) {
          const wrapper = node('div'); wrapper.setAttribute('role', 'listitem');
          const rowClass = String(classes[4] || 'sidebar-item h-[var(--height-token-row)] py-row-y px-2').split(' ').filter(value => value !== 'bg-primary-ghost-hover').join(' ');
          const row = node('button', rowClass + ' flex w-full min-w-0 items-center gap-2 text-start');
          // Newer native rows apply their leading inset to a React-owned inner
          // title container. Our alias owns its title spans, so preserve that
          // inset explicitly instead of relying on the outer row template.
          row.style.paddingInlineStart = 'var(--padding-row-cell-x,var(--padding-row-x,8px))';
          row.type = 'button'; row.setAttribute('draggable', 'false'); row.setAttribute('data-attention-thread-id', item.id);
          row.setAttribute('aria-label', item.title + ' · ' + item.projectLabel); row.title = item.title + ' · ' + item.projectLabel;
          row.append(node('span', 'min-w-0 flex-1 truncate', item.title), node('span', 'max-w-[35%] shrink-0 truncate text-xs text-tertiary', item.projectLabel));
          row.addEventListener('click', () => {
            if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id)) {
              window.__codexControlConsoleClose?.();
              window.__codexControlConsoleConversationTabs?.openLocal?.({ id: item.id, title: item.title });
              if (!window.__codexControlConsoleConversationTabs?.openLocal) recordView(item);
              window.postMessage({ type: 'navigate-to-route', path: '/local/' + item.id }, '*');
            }
          });
          wrapper.append(row); list.append(wrapper);
        }
        section.append(list);
      }
      root.append(section); next.push(root);
    }
    roots.forEach(root => root.remove()); roots = next;
    for (const root of roots) parent.insertBefore(root, native.parentElement);
  }
  function recordView(task) {
    if (!history.view(task, Date.now(), snapshot.items.find(item => item.id === task.id))) return;
    try { localStorage.setItem(HISTORY, JSON.stringify(history.list())); } catch { /* in-memory still works */ }
    render();
  }
  function schedule() {
    if (pending || disposed) return; pending = true;
    requestAnimationFrame(() => { pending = false; render(); });
  }
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.__codexControlConsoleAttentionConversations = {
    version: VERSION,
    view: recordView,
    set(value) { snapshot = value && Array.isArray(value.items) ? value : { items: [], stale: true }; render(); },
    dispose() { disposed = true; observer.disconnect(); roots.forEach(root => root.remove()); }
  };
  render();
}
export function buildNativeAttentionConversationsInjectionScript() {
  return `(${installNativeAttentionConversations.toString()})(${createConversationViewHistory.toString()})`;
}
export function buildNativeAttentionConversationsSnapshotScript(snapshot = { items: [], stale: true }) {
  return `window.__codexControlConsoleAttentionConversations?.set(${JSON.stringify(snapshot).replaceAll('<', '\\u003c')})`;
}
