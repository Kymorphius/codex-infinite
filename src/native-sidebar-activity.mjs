// Marks native status rails and mirrors their icon on the owning project. The rail stays at
// its native trailing position (2026-09-28): the leading slot belongs to companion toggles.
// Also quiets the native browser panel's hidden loading bar (see stylesheet).
export function buildNativeSidebarActivityInjectionScript() {
  const stylesheet = [
    '@keyframes ccc-project-status-spin{to{transform:rotate(360deg)}}',
    '[data-ccc-project-status-host]{display:flex;min-width:0;align-items:center}',
    '[data-ccc-project-status-host]::before{content:"";display:inline-block;box-sizing:border-box;width:14px;height:14px;flex:0 0 14px;margin-right:6px;background:var(--ccc-project-status-color,currentColor);-webkit-mask:var(--ccc-project-status-mask) center/contain no-repeat;mask:var(--ccc-project-status-mask) center/contain no-repeat;opacity:.82}',
    '[data-ccc-project-status-kind="running"]::before{animation:ccc-project-status-spin 2s linear infinite}',
    // The native browser panel keeps pulsing its loading bar after hiding it with opacity-0.
    // Invisible, it still re-layerizes the page every frame (about a sixth of the main thread).
    '[data-browser-host-root] .opacity-0>.animate-pulse{animation:none!important}'
  ].join('');
  return `(() => {
  const VERSION = '2026-09-29.1';
  const STYLE_ID = 'codex-control-console-sidebar-activity-style';
  const THREAD = '[data-app-action-sidebar-thread-id]';
  const PROJECT = '[data-app-action-sidebar-project-id]';
  const PROJECT_LIST = '[data-app-action-sidebar-project-list-id]';
  const RAIL = '[data-ccc-native-status-rail]';
  const PROJECT_HOST = '[data-ccc-project-status-host]';
  const WATCHED = THREAD + ',' + PROJECT + ',' + PROJECT_LIST;
  const ATTRIBUTES = ['data-ccc-native-status-rail', 'data-ccc-has-native-status', 'data-ccc-project-status-host', 'data-ccc-project-status-kind',
    'data-ccc-running-thread', 'data-ccc-running-project', 'data-ccc-running-host'];
  const PROPERTIES = ['--ccc-project-status-mask', '--ccc-project-status-color'];
  if (window.__codexControlConsoleSidebarActivityVersion === VERSION && window.__codexControlConsoleSidebarActivityObserver) return;
  window.__codexControlConsoleSidebarActivityObserver?.disconnect?.();
  window.__codexControlConsoleSidebarActivityVersion = VERSION;
  let pending = false;
  // Nodes carrying our marks, including leftovers from an older version of this script.
  const marked = new Set(document.querySelectorAll(RAIL + ',[data-ccc-has-native-status],' + PROJECT_HOST + ',[data-ccc-running-thread],[data-ccc-running-project],[data-ccc-running-host]'));
  const colors = new WeakMap();
  function ensureStyle() {
    let style = document.getElementById(STYLE_ID);
    if (!style) { style = document.createElement('style'); style.id = STYLE_ID; (document.head || document.documentElement).append(style); }
    const source = ${JSON.stringify(stylesheet)}; if (style.textContent !== source) style.textContent = source;
  }
  function statusRail(row) {
    return Array.from(row.querySelectorAll('div')).find(node => (
      node.classList.contains('absolute')
      && node.classList.contains('end-0')
      && node.classList.contains('group-hover:hidden')
      && node.children.length > 0
    )) || null;
  }
  function projectFor(row, projects) {
    const listId = row.closest(PROJECT_LIST)?.getAttribute('data-app-action-sidebar-project-list-id') || '';
    if (!listId) return null;
    return projects.get(listId) || projects.get(listId.replace(/^local-/, '')) || projects.get('local-' + listId) || null;
  }
  function projectHost(row) { return row.querySelector('.text-base') || row.querySelector('[class*="min-w-0"][class*="flex-1"]') || null; }
  // getComputedStyle forces a whole-page style recalculation; read each rail color once per class and theme.
  function railColor(node) {
    const root = document.documentElement;
    const key = (node.getAttribute?.('class') || '') + '|' + (root.getAttribute?.('class') || '') + '|' + (root.getAttribute?.('data-theme') || '');
    const cached = colors.get(node); if (cached?.key === key) return cached.color;
    const color = getComputedStyle(node).color; colors.set(node, { key, color }); return color;
  }
  function projectStatus(rail) {
    const svg = rail.querySelector('svg'); if (!svg?.outerHTML) return null;
    const running = Boolean(rail.querySelector('[class~="motion-safe:animate-spin"]'));
    return { kind: running ? 'running' : 'native', mask: 'url("data:image/svg+xml,' + encodeURIComponent(svg.outerHTML) + '")', color: railColor(rail.firstElementChild || rail) };
  }
  // Writes only differences: rewriting unchanged marks invalidated page styles on every run.
  function apply(desired) {
    for (const node of marked) if (!desired.has(node)) {
      for (const name of ATTRIBUTES) if (node.getAttribute(name) !== null) node.removeAttribute(name);
      for (const name of PROPERTIES) if (node.style?.getPropertyValue?.(name)) node.style.removeProperty(name);
      marked.delete(node);
    }
    for (const [node, { attributes, properties }] of desired) {
      for (const name of ATTRIBUTES) {
        const value = Object.hasOwn(attributes, name) ? attributes[name] : null;
        if (node.getAttribute(name) === value) continue;
        if (value === null) node.removeAttribute(name); else node.setAttribute(name, value);
      }
      for (const name of PROPERTIES) {
        const value = properties[name] || '';
        if ((node.style?.getPropertyValue?.(name) || '') === value) continue;
        if (value) node.style.setProperty(name, value); else node.style.removeProperty(name);
      }
      marked.add(node);
    }
  }
  function render() {
    ensureStyle();
    const desired = new Map(), mark = (node, attributes, properties = {}) => desired.set(node, { attributes, properties });
    const projectNodes = new Map();
    for (const node of document.querySelectorAll(PROJECT)) { const id = node.getAttribute('data-app-action-sidebar-project-id') || ''; if (id && !projectNodes.has(id)) projectNodes.set(id, node); }
    const projects = new Map();
    for (const row of document.querySelectorAll(THREAD)) {
      const rail = statusRail(row); if (!rail) continue;
      mark(rail, { 'data-ccc-native-status-rail': '' });
      mark(row, { 'data-ccc-has-native-status': '' });
      const project = projectFor(row, projectNodes), status = project && projectStatus(rail);
      if (!project || !status) continue;
      const current = projects.get(project);
      if (!current || (status.kind === 'running' && current.kind !== 'running')) projects.set(project, status);
    }
    for (const [project, status] of projects) {
      const host = projectHost(project); if (!host) continue;
      mark(host, { 'data-ccc-project-status-host': '', 'data-ccc-project-status-kind': status.kind },
        { '--ccc-project-status-mask': status.mask, '--ccc-project-status-color': status.color || 'currentColor' });
    }
    apply(desired);
  }
  // Only sidebar rows and project lists affect the marks. The page mutates constantly while a
  // conversation streams; rendering for every one of those starved terminal and chat updates.
  function touchesSidebar(node) {
    const element = node?.nodeType === 1 ? node : node?.parentElement;
    return Boolean(element?.closest?.(WATCHED));
  }
  function containsSidebar(nodes) {
    for (const node of nodes || []) if (node.nodeType === 1 && (node.matches?.(WATCHED) || node.querySelector?.(WATCHED))) return true;
    return false;
  }
  function relevant(records) {
    return records.some(record => touchesSidebar(record.target) || containsSidebar(record.addedNodes) || containsSidebar(record.removedNodes));
  }
  function schedule() { if (pending) return; pending = true; queueMicrotask(() => { pending = false; render(); }); }
  const observer = new MutationObserver(records => { if (relevant(records)) schedule(); });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-app-action-sidebar-project-list-id'] });
  // A theme switch changes rail colors without touching the sidebar.
  const theme = new MutationObserver(schedule);
  theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
  window.__codexControlConsoleSidebarActivityObserver = { disconnect() { observer.disconnect(); theme.disconnect(); } };
  schedule();
})()`;
}
