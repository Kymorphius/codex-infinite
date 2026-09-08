// Repositions native status rails with CSS; React retains ownership of their nodes.
export function buildNativeSidebarActivityInjectionScript() {
  const stylesheet = [
    '@keyframes ccc-project-status-spin{to{transform:rotate(360deg)}}',
    '[data-ccc-native-status-rail]{inset-inline-start:6px!important;inset-inline-end:auto!important;min-width:20px!important;width:20px!important;padding-inline:0!important;justify-content:center!important}',
    '[data-ccc-project-status-host]{display:flex;min-width:0;align-items:center}',
    '[data-ccc-project-status-host]::before{content:"";display:inline-block;box-sizing:border-box;width:14px;height:14px;flex:0 0 14px;margin-right:6px;background:var(--ccc-project-status-color,currentColor);-webkit-mask:var(--ccc-project-status-mask) center/contain no-repeat;mask:var(--ccc-project-status-mask) center/contain no-repeat;opacity:.82}',
    '[data-ccc-project-status-kind="running"]::before{animation:ccc-project-status-spin 2s linear infinite}'
  ].join('');
  return `(() => {
  const VERSION = '2026-09-07.5';
  const STYLE_ID = 'codex-control-console-sidebar-activity-style';
  const THREAD = '[data-app-action-sidebar-thread-id]';
  const PROJECT = '[data-app-action-sidebar-project-id]';
  const PROJECT_LIST = '[data-app-action-sidebar-project-list-id]';
  const RAIL = '[data-ccc-native-status-rail]';
  const PROJECT_HOST = '[data-ccc-project-status-host]';
  if (window.__codexControlConsoleSidebarActivityVersion === VERSION && window.__codexControlConsoleSidebarActivityObserver) return;
  window.__codexControlConsoleSidebarActivityObserver?.disconnect?.();
  window.__codexControlConsoleSidebarActivityVersion = VERSION;
  let pending = false;
  function clear(node) {
    node.removeAttribute('data-ccc-native-status-rail');
    node.removeAttribute('data-ccc-has-native-status');
    node.removeAttribute('data-ccc-project-status-host');
    node.removeAttribute('data-ccc-project-status-kind');
    node.removeAttribute('data-ccc-running-thread');
    node.removeAttribute('data-ccc-running-project');
    node.removeAttribute('data-ccc-running-host');
    node.style?.removeProperty?.('--ccc-project-status-mask');
    node.style?.removeProperty?.('--ccc-project-status-color');
  }
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
  function projectFor(row) {
    const listId = row.closest(PROJECT_LIST)?.getAttribute('data-app-action-sidebar-project-list-id') || '';
    if (!listId) return null;
    const candidates = new Set([listId, listId.replace(/^local-/, ''), 'local-' + listId]);
    return Array.from(document.querySelectorAll(PROJECT)).find(node => candidates.has(node.getAttribute('data-app-action-sidebar-project-id') || '')) || null;
  }
  function projectHost(row) { return row.querySelector('.text-base') || row.querySelector('[class*="min-w-0"][class*="flex-1"]') || null; }
  function projectStatus(rail) {
    const svg = rail.querySelector('svg'); if (!svg?.outerHTML) return null;
    const running = Boolean(rail.querySelector('[class~="motion-safe:animate-spin"]'));
    const colorNode = rail.firstElementChild || rail;
    return { kind: running ? 'running' : 'native', mask: 'url("data:image/svg+xml,' + encodeURIComponent(svg.outerHTML) + '")', color: getComputedStyle(colorNode).color };
  }
  function render() {
    ensureStyle();
    document.querySelectorAll(RAIL + ',[data-ccc-has-native-status],' + PROJECT_HOST + ',[data-ccc-running-thread],[data-ccc-running-project],[data-ccc-running-host]').forEach(clear);
    const projects = new Map();
    for (const row of document.querySelectorAll(THREAD)) {
      const rail = statusRail(row); if (!rail) continue;
      rail.setAttribute('data-ccc-native-status-rail', '');
      row.setAttribute('data-ccc-has-native-status', '');
      const project = projectFor(row), status = projectStatus(rail);
      if (!project || !status) continue;
      const current = projects.get(project);
      if (!current || (status.kind === 'running' && current.kind !== 'running')) projects.set(project, status);
    }
    for (const [project, status] of projects) {
      const host = projectHost(project); if (!host) continue;
      host.setAttribute('data-ccc-project-status-host', '');
      host.setAttribute('data-ccc-project-status-kind', status.kind);
      host.style.setProperty('--ccc-project-status-mask', status.mask);
      host.style.setProperty('--ccc-project-status-color', status.color || 'currentColor');
    }
  }
  function schedule() { if (pending) return; pending = true; queueMicrotask(() => { pending = false; render(); }); }
  window.__codexControlConsoleSidebarActivityObserver = new MutationObserver(schedule);
  window.__codexControlConsoleSidebarActivityObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-app-action-sidebar-project-list-id'] });
  schedule();
})()`;
}
