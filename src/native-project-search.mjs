import { buildNativeNewTaskAdapterScript } from './native-new-task-adapter.mjs';
import { filterProjectNames } from './project-search.mjs';
import { installNativeProjectSearchActions } from './native-project-search-actions.mjs';

export function installNativeProjectSearch(filter) {
  const VERSION = '2026-09-07.4';
  if (window.__codexControlConsoleProjectSearch?.version === VERSION) return;
  const saved = window.__codexControlConsoleProjectSearch?.getState?.() || { query: document.querySelector('[data-codex-control-console-project-search] input')?.value || '', expanded: [] };
  window.__codexControlConsoleProjectSearch?.dispose();
  const ATTR = 'data-codex-control-console-project-search';
  document.querySelectorAll('[' + ATTR + ']').forEach(node => node.remove());
  let root, input, results, clear, signature = '', disposed = false, scheduled = false;
  let snapshot = { projects: [], stale: true };
  const expanded = new Set(saved.expanded);
  const make = (tag, cls, text) => {
    const node = document.createElement(tag); node.className = cls || '';
    if (text != null) node.textContent = text;
    return node;
  };
  function cleanClass(value) {
    return String(value || '').split(' ').filter(token => token !== 'bg-primary-ghost-hover').join(' ');
  }
  function templates() {
    const project = document.querySelector('[data-app-action-sidebar-project-id]');
    const thread = document.querySelector('[data-app-action-sidebar-thread-row]');
    const closed = document.querySelector('[data-app-action-sidebar-project-collapsed="true"] .icon-leading-slot svg');
    const open = document.querySelector('[data-app-action-sidebar-project-collapsed="false"] .icon-leading-slot svg');
    return { project: cleanClass(project?.className) || 'group relative sidebar-item flex items-center h-[var(--height-token-row)] hover:bg-primary-ghost-hover text-default',
      thread: cleanClass(thread?.className) || 'group relative sidebar-item h-[var(--height-token-row)] hover:bg-primary-ghost-hover py-row-y pe-row-y text-sm',
      label: project?.querySelector?.('.text-base')?.className || 'flex min-w-0 flex-1 items-center gap-2 whitespace-nowrap rounded-md py-1 pe-0 text-start text-base text-default',
      closed, open, signature: [project?.className, thread?.className, closed?.outerHTML, open?.outerHTML] };
  }
  function folder(source, open) {
    const tags = new Set(['svg', 'path', 'g', 'circle', 'rect', 'line', 'polyline']);
    const attrs = new Set(['viewBox', 'width', 'height', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'fill-rule', 'clip-rule', 'd', 'transform', 'cx', 'cy', 'r', 'x', 'y', 'rx', 'points', 'x1', 'x2', 'y1', 'y2']);
    function copy(node) {
      const tag = node?.tagName?.toLowerCase(); if (!tags.has(tag)) return null;
      const next = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const attr of Array.from(node.attributes || [])) if (attrs.has(attr.name)) next.setAttribute(attr.name, attr.value);
      for (const child of Array.from(node.children || [])) { const safe = copy(child); if (safe) next.append(safe); }
      return next;
    }
    const svg = copy(source) || document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    if (!source) {
      svg.setAttribute('viewBox', '0 0 16 16');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', open ? 'M1 3h5l2 2h6v2H5l-3 6H1Zm4 5h10l-3 5H3Z' : 'M1 3h5l2 2h7v8H1Z');
      path.setAttribute('fill', 'currentColor'); svg.append(path);
    }
    svg.setAttribute('class', 'icon-xs shrink-0'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
    return svg;
  }
  function render() {
    if (disposed) return;
    const native = document.querySelector('section[data-app-action-sidebar-section-heading="Projects"]');
    const parent = native?.parentElement?.parentElement;
    if (!parent) return;
    if (!root) {
      root = make('div', 'py-1'); root.setAttribute(ATTR, ''); root.style.order = '4';
      const bar = make('div', 'flex items-center gap-1 rounded-md border border-token-border-default px-2');
      input = make('input', 'min-w-0 flex-1 bg-transparent py-1 text-base text-default outline-none');
      input.value = saved.query || '';
      input.type = 'search'; input.placeholder = '搜索本机和远端项目'; input.setAttribute('aria-label', '搜索项目名称');
      clear = make('button', 'shrink-0 text-sm text-tertiary', '清空'); clear.type = 'button'; clear.setAttribute('aria-label', '清空项目搜索');
      clear.addEventListener('click', () => { input.value = ''; expanded.clear(); render(); input.focus(); });
      input.addEventListener('input', () => { expanded.clear(); render(); });
      input.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); input.value = ''; expanded.clear(); render(); } });
      results = make('div', 'flex flex-col'); results.setAttribute('aria-label', '项目搜索结果');
      bar.append(input, clear); root.append(bar, results);
      root.addEventListener('pointerdown', event => event.stopPropagation());
      root.addEventListener('dragstart', event => { event.preventDefault(); event.stopPropagation(); });
    }
    if (root.parentElement !== parent) parent.insertBefore(root, native.parentElement);
    const query = input.value || '';
    const style = templates();
    const next = JSON.stringify([query, snapshot, [...expanded], style.signature]);
    root.className = (native.className || 'relative px-row-x') + ' py-1';
    if (signature === next) return;
    signature = next;
    clear.hidden = !query;
    results.replaceChildren();
    if (!query.trim()) return;
    const projects = filter(snapshot.projects, query);
    const status = make('div', 'px-1 py-1 text-sm text-tertiary', (projects.length ? projects.length + ' 个项目' : '没有匹配的项目') + (snapshot.stale ? ' · 本机列表暂未更新' : ''));
    status.setAttribute('role', 'status'); results.append(status);
    for (const project of projects) {
      const key = project.searchKey || project.id, remote = project.device?.kind === 'remote-codex';
      const deviceLabel = remote ? project.device.name + (project.device.status === 'connected' ? '' : ' · 离线') : '本机';
      const open = expanded.has(key);
      const button = make('div', style.project + ' w-full text-start');
      button.setAttribute('role', 'button'); button.tabIndex = 0; button.setAttribute('data-project-search-id', key);
      button.setAttribute('aria-expanded', String(open)); button.title = project.name + ' · ' + deviceLabel;
      button.setAttribute('draggable', 'false');
      const content = make('span', 'flex min-w-0 flex-1 items-center');
      const iconWrap = make('span', 'flex shrink-0 items-center ps-1 pe-1 browser:pe-0');
      const slot = make('span', '-mx-[3px] flex icon-leading-slot size-[var(--height-token-row)] shrink-0 items-center justify-center browser:-mx-0.5');
      slot.append(folder(open ? style.open : style.closed, open)); iconWrap.append(slot);
      const label = make('span', style.label); label.append(make('span', 'min-w-0 truncate select-none', project.name));
      label.append(make('span', 'shrink-0 text-xs text-tertiary', deviceLabel));
      content.append(iconWrap, label); button.append(content);
      const create = make('button', 'sidebar-icon-button shrink-0 rounded-md text-default', '+');
      create.type = 'button'; create.style.cssText = 'display:flex;align-items:center;justify-content:center;width:24px;height:24px;margin-inline:4px;flex-shrink:0;font-size:20px;line-height:1;';
      create.setAttribute('data-project-search-create', key);
      create.setAttribute('aria-label', '在 ' + project.name + ' 中新建会话');
      create.disabled = remote;
      create.title = remote ? '请在 ' + project.device.name + ' 上新建会话' : '新建会话';
      create.addEventListener('click', event => { event.stopPropagation(); if (!create.disabled) window.__cccProjectSearchActions?.create(project); });
      create.addEventListener('keydown', event => event.stopPropagation());
      button.append(create);
      button.addEventListener('click', () => { if (expanded.has(key)) expanded.delete(key); else expanded.add(key); render(); });
      button.addEventListener('keydown', event => { if (event.target === button && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); button.click(); } });
      results.append(button);
      if (!open) continue;
      if (!project.tasks.length) results.append(make('div', 'ps-6 py-1 text-sm text-tertiary', '暂无最近会话'));
      for (const task of project.tasks) {
        const row = make('button', style.thread + ' flex w-full min-w-0 items-center text-start');
        row.style.paddingInlineStart = 'calc(var(--padding-row-cell-x,var(--padding-row-x)) + 24px)';
        row.setAttribute('draggable', 'false'); row.setAttribute('data-project-search-thread-id', task.id);
        const title = make('span', 'flex min-w-0 flex-1 items-center text-base leading-5 text-default');
        title.append(make('span', 'min-w-0 truncate', task.title)); row.append(title);
        row.type = 'button'; row.disabled = remote && (project.device.status !== 'connected' || typeof window.__codexControlConsoleOpenRemoteConversation !== 'function');
        row.title = row.disabled ? '设备离线或连接未就绪，暂时无法打开：' + task.title : task.title;
        if (row.disabled) row.style.opacity = '.62';
        row.addEventListener('click', () => {
          if (row.disabled) return;
          if (remote) {
            window.__codexControlConsoleOpenRemoteConversation?.({ id: task.id, deviceId: project.device.id, title: task.title, cwd: project.sourceDirectory, deviceName: project.device.name });
            return;
          }
          if (/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(task.id)) {
            window.__codexControlConsoleClose?.();
            window.__codexControlConsoleConversationTabs?.openLocal?.({ id: task.id, title: task.title });
            window.postMessage({ type: 'navigate-to-route', path: '/local/' + task.id }, '*');
          }
        });
        results.append(row);
      }
      if (project.hiddenConversationCount) results.append(make('div', 'ps-6 py-1 text-sm text-tertiary', '另有 ' + project.hiddenConversationCount + ' 个会话未在此列出'));
    }
  }
  const observer = new MutationObserver(() => {
    if (scheduled || disposed) return; scheduled = true;
    requestAnimationFrame(() => { scheduled = false; render(); });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.__codexControlConsoleProjectSearch = {
    version: VERSION,
    getState() { return { query: input?.value || '', expanded: [...expanded] }; },
    set(value) { snapshot = value && Array.isArray(value.projects) ? value : { projects: [], stale: true }; render(); },
    dispose() { disposed = true; observer.disconnect(); root?.remove(); }
  };
  render();
}
export function buildNativeProjectSearchInjectionScript() {
  return `${buildNativeNewTaskAdapterScript()}(${installNativeProjectSearchActions.toString()})();(${installNativeProjectSearch.toString()})(${filterProjectNames.toString()})`;
}
export function buildNativeProjectSearchSnapshotScript(value = { projects: [], stale: true }) {
  return `window.__codexControlConsoleProjectSearch?.set(${JSON.stringify(value).replaceAll('<', '\\u003c')})`;
}
