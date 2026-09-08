// Presentation-only grouping. Native nodes and execution ownership remain native.
export function installUnifiedSidebar(onChange) {
  window.__codexControlConsoleUnifiedSidebar?.dispose();
  const KEY = 'codex-control-console.unified-sidebar.v1';
  const ATTR = 'data-codex-control-console-unified-list';
  let saved;
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { saved = {}; }
  let enabled = saved?.enabled === true;
  const assignments = new Map((Array.isArray(saved?.assignments) ? saved.assignments : []).slice(0, 512)
    .filter(entry => Array.isArray(entry) && entry.length === 2 && entry.every(value => typeof value === 'string' && value.length <= 1024)));
  let groups = new Map(), disposed = false, scheduled = false;
  const control = document.createElement('div');
  control.setAttribute('data-codex-control-console-unified-control', '');
  control.style.cssText = 'display:flex;justify-content:flex-end;padding:3px 10px;order:-1;';
  const button = document.createElement('button');
  button.type = 'button'; button.textContent = '统一';
  button.setAttribute('data-codex-control-console-unified-toggle', '');
  button.setAttribute('aria-label', '统一侧边栏');
  button.style.cssText = 'border:1px solid #8885;border-radius:6px;padding:3px 9px;font:inherit;font-size:12px;color:inherit;-webkit-app-region:no-drag';
  control.append(button);
  const identity = (device, project) => JSON.stringify([device.id, project.key]);
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ enabled, assignments: [...assignments].slice(-512) })); } catch { /* Storage can be unavailable. */ }
  }
  function sections() {
    return Array.from(document.querySelectorAll('section[data-app-action-sidebar-section-heading]'));
  }
  const heading = section => section.getAttribute('data-app-action-sidebar-section-heading');
  function destinations() {
    const all = sections();
    const excluded = new Set(['Recents', 'Threads', 'Chats', 'Work', 'Cloud', 'Pinned', 'pinned', '固定', '置顶', '已置顶', '项目（聊天）', '云工作', 'Projects']);
    return [{ key: 'Projects', label: '项目' }, ...all.filter(section => {
      const key = heading(section);
      return key && !excluded.has(key) && !section.hasAttribute('data-codex-control-console-chat-source-bootstrapped')
        && all.filter(other => heading(other) === key).length === 1;
    }).map(section => ({ key: heading(section), label: section.querySelector('[data-app-action-sidebar-section-toggle]')?.textContent.trim() || heading(section) }))];
  }
  function destination(device, project) {
    const key = assignments.get(identity(device, project));
    return destinations().some(item => item.key === key) ? key : 'Projects';
  }
  function reset() { for (const group of groups.values()) group.remove(); groups = new Map(); }
  function container(device, project) {
    const key = project ? destination(device, project) : 'Projects';
    if (!groups.has(key)) {
      const node = document.createElement('div'); node.setAttribute(ATTR, key);
      node.className = 'flex flex-col px-row-x';
      // Remote aliases must not enter native drag-and-drop ownership.
      node.addEventListener('pointerdown', event => event.stopPropagation());
      node.addEventListener('dragstart', event => { event.preventDefault(); event.stopPropagation(); });
      groups.set(key, node);
    }
    return groups.get(key);
  }
  function place() {
    if (disposed) return;
    const all = sections(), projects = all.find(section => heading(section) === 'Projects');
    const parent = projects?.parentElement?.parentElement;
    const newChat = Array.from(document.querySelectorAll('button')).find(node => /^(新聊天|New chat)$/.test((node.textContent || '').trim()));
    if (newChat) {
      if (control.parentElement !== document.body) document.body.append(control);
      const rect = newChat.getBoundingClientRect();
      control.style.cssText = 'position:fixed;z-index:60;display:' + (rect.width > 100 && rect.height > 0 ? 'flex' : 'none') + ';padding:0;-webkit-app-region:no-drag;right:auto;left:' + (rect.right - 68) + 'px;top:' + (rect.top + Math.max(0, (rect.height - 28) / 2)) + 'px';
    } else if (parent && control.parentElement !== parent) parent.insertBefore(control, parent.firstChild);
    button.setAttribute('aria-pressed', String(enabled));
    button.title = enabled ? '关闭统一显示，恢复本地与远端分区' : '统一显示和管理本地、远端项目';
    button.style.background = enabled ? 'var(--color-background-selected,#8883)' : 'transparent';
    for (const [key, group] of groups) {
      const matches = all.filter(section => heading(section) === key);
      const section = matches.length === 1 ? matches[0] : projects;
      if (!enabled || !section) { group.remove(); continue; }
      if (group.parentElement !== section.parentElement) section.parentElement.append(group);
      group.hidden = section.getAttribute('data-app-action-sidebar-section-collapsed') === 'true'
        || section.querySelector('[data-app-action-sidebar-section-toggle]')?.getAttribute('aria-expanded') === 'false';
      group.style.display = group.hidden ? 'none' : 'flex';
    }
  }
  function change(value) { enabled = value; save(); reset(); onChange(); place(); }
  button.addEventListener('click', () => change(!enabled));
  function schedule() {
    if (scheduled || disposed) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; place(); });
  }
  function onStorage(event) {
    if (event.key !== KEY) return;
    try {
      const state = JSON.parse(event.newValue || '{}');
      assignments.clear();
      for (const entry of (Array.isArray(state.assignments) ? state.assignments : []).slice(0, 512)) {
        if (Array.isArray(entry) && entry.length === 2 && entry.every(value => typeof value === 'string' && value.length <= 1024)) assignments.set(...entry);
      }
      enabled = state.enabled === true; reset(); onChange(); place();
    } catch { /* Ignore malformed external state. */ }
  }
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-app-action-sidebar-section-collapsed', 'data-app-action-sidebar-section-heading', 'aria-expanded'] });
  window.addEventListener('storage', onStorage); window.addEventListener('resize', schedule);
  const api = {
    get enabled() { return enabled; }, container, reset, place, destinations, destination,
    assign(device, project, key) {
      if (!destinations().some(item => item.key === key)) return false;
      assignments.set(identity(device, project), key); save(); reset(); onChange(); place(); return true;
    },
    dispose() { disposed = true; observer.disconnect(); window.removeEventListener('storage', onStorage); window.removeEventListener('resize', schedule); reset(); control.remove(); }
  };
  window.__codexControlConsoleUnifiedSidebar = api;
  place();
  return api;
}

export function buildNativeUnifiedSidebarSource() {
  return `const unifiedSidebar = (${installUnifiedSidebar.toString()})(() => { closeProjectMenu(); render(); ensurePlacement(); });`;
}
