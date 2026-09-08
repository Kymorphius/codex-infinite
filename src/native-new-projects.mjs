// This root and its children belong to the console; native rows remain untouched.
export function installNativeNewProjects() {
  const VERSION = '2026-09-05.5';
  if (window.__codexControlConsoleNewProjects?.version === VERSION) return;
  window.__codexControlConsoleNewProjects?.dispose();
  const ROOT = 'data-codex-control-console-new-projects';
  document.querySelectorAll('[' + ROOT + ']').forEach(node => node.remove());
  const STORAGE = 'codex-control-console.new-projects.expansion.v1';
  let state = {};
  try { state = JSON.parse(localStorage.getItem(STORAGE) || '{}') || {}; } catch { /* optional UI state */ }
  let expanded = state.expanded !== false;
  const openProjects = new Set(Array.isArray(state.projects) ? state.projects : []);
  let projects = [];
  let root = null;
  let signature = '';
  let scheduled = false;
  let disposed = false;
  function save() {
    try { localStorage.setItem(STORAGE, JSON.stringify({ expanded, projects: [...openProjects] })); } catch { /* optional UI state */ }
  }
  function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className || '';
    if (text != null) node.textContent = text;
    return node;
  }
  function icon(source, fallbackPath, className, viewBox = '0 0 20 21') {
    const allowed = new Set(['svg', 'path', 'g', 'circle', 'rect', 'line', 'polyline']);
    const attributes = new Set(['width', 'height', 'viewBox', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'fill-rule', 'clip-rule', 'd', 'transform', 'cx', 'cy', 'r', 'x', 'y', 'rx', 'points', 'x1', 'x2', 'y1', 'y2']);
    function copy(node) {
      const name = node?.tagName?.toLowerCase();
      if (!allowed.has(name)) return null;
      const next = document.createElementNS('http://www.w3.org/2000/svg', name);
      for (const attr of Array.from(node.attributes || [])) if (attributes.has(attr.name)) next.setAttribute(attr.name, attr.value);
      for (const child of Array.from(node.children || [])) { const result = copy(child); if (result) next.append(result); }
      return next;
    }
    const svg = copy(source) || document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    if (!source?.tagName) {
      svg.setAttribute('viewBox', viewBox);
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', fallbackPath); path.setAttribute('fill', 'currentColor'); svg.append(path);
    }
    svg.setAttribute('class', className); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
    return svg;
  }
  function disclosure(button, open, toggle) {
    button.type = 'button';
    button.setAttribute('draggable', 'false');
    button.setAttribute('aria-expanded', String(open));
    button.addEventListener('click', toggle);
  }
  function render() {
    if (disposed) return;
    const native = document.querySelector('section[data-app-action-sidebar-section-heading="Projects"]');
    const parent = native?.parentElement?.parentElement;
    if (!parent) return;
    const items = projects.filter((project) => project.expiresAt > Date.now());
    const nativeHeading = native.querySelector('[class*="nav-section-title"]');
    const nativeToggle = native.querySelector('[data-app-action-sidebar-section-toggle]');
    const nativeRow = document.querySelector('[data-app-action-sidebar-project-id]');
    const headingIcon = nativeToggle?.querySelector('svg');
    const nativeCreate = native.querySelector('[data-app-action-sidebar-project-create]');
    const folderIcon = nativeRow?.querySelector('svg');
    const nativeThread = document.querySelector('[data-app-action-sidebar-thread-row]');
    const projectClass = String(nativeRow?.className || '').split(' ').filter(token => token !== 'bg-primary-ghost-hover').join(' ');
    const headingTextClass = nativeHeading?.firstElementChild?.className || 'min-w-0 flex-1 text-base font-medium text-tertiary opacity-75 browser:leading-4.5';
    const classes = [nativeHeading?.className, nativeToggle?.className, projectClass, headingTextClass, native.className, headingIcon?.outerHTML, folderIcon?.outerHTML, nativeThread?.className, nativeCreate?.className, Boolean(nativeCreate), nativeCreate?.disabled];
    const nextSignature = JSON.stringify([items, expanded, [...openProjects], classes]);
    if (root?.parentElement === parent && signature === nextSignature) return;
    signature = nextSignature;
    const next = element('div', 'flex flex-col');
    next.setAttribute(ROOT, '');
    next.setAttribute('draggable', 'false');
    // No native sortable/droppable IDs are registered for this automatic view.
    for (const type of ['dragstart', 'dragenter', 'dragover', 'drop']) {
      next.addEventListener(type, event => {
        event.preventDefault(); event.stopPropagation();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
      }, true);
    }
    next.addEventListener('pointerdown', event => event.stopPropagation());
    next.style.order = '35';
    const section = element('section', native.className || 'relative px-row-x');
    section.setAttribute('aria-label', '新项目');
    const heading = element('div', classes[0] || 'group/nav-section-title flex items-center gap-2 ps-2');
    const toggle = element('button', classes[1] || 'flex min-w-0 flex-1 items-center gap-1 py-0.5 text-start text-tertiary');
    const title = element('span', 'min-w-0 truncate', '新项目');
    const arrow = icon(headingIcon, 'M4 7.7 10 13.7 16 7.7 15 6.7 10 11.7 5 6.7Z', 'icon-disclosure shrink-0 transition-transform group-hover/section-toggle:opacity-100 group-focus-visible/section-toggle:opacity-100 sidebar-hover-icon-tint opacity-0 ' + (expanded ? 'rotate-0' : '-rotate-90'));
    arrow.setAttribute('aria-hidden', 'true');
    toggle.title = '自动分类，不支持拖入或拖出';
    toggle.append(title, arrow);
    disclosure(toggle, expanded, () => { expanded = !expanded; save(); render(); });
    const headingText = element('div', classes[3]);
    const headingInner = element('div', 'flex min-w-0 flex-1');
    headingInner.append(toggle); headingText.append(headingInner); heading.append(headingText);
    const actions = element('div', 'flex shrink-0 items-center gap-1 opacity-0 group-hover/nav-section-title:opacity-100 group-focus-within/nav-section-title:opacity-100');
    const create = element('button', nativeCreate?.className || 'sidebar-icon-button flex items-center justify-center p-1');
    create.type = 'button'; create.disabled = !nativeCreate || nativeCreate.disabled;
    create.setAttribute('data-new-project-create', 'true');
    create.setAttribute('draggable', 'false'); create.setAttribute('aria-label', '添加新项目');
    create.title = '添加新项目';
    create.append(icon(nativeCreate?.querySelector('svg'), 'M7.5 2h1v5.5H14v1H8.5V14h-1V8.5H2v-1h5.5Z', 'icon-sm', '0 0 16 16'));
    create.addEventListener('click', () => {
      document.querySelector('section[data-app-action-sidebar-section-heading="Projects"] [data-app-action-sidebar-project-create]')?.click();
    });
    actions.append(create); heading.append(actions);
    section.append(heading);
    if (expanded) {
      const list = element('div', 'flex flex-col');
      list.setAttribute('role', 'list');
      if (!items.length) list.append(element('div', 'px-2 py-2 text-base text-tertiary', '暂无新项目'));
      for (const project of items) {
        const item = element('div', 'flex flex-col');
        item.setAttribute('role', 'listitem');
        const open = openProjects.has(project.id);
        const row = element('button', classes[2] || 'flex items-center gap-2 sidebar-item text-sm py-row-y px-3 text-start');
        row.setAttribute('data-new-project-id', project.id);
        row.title = project.name;
        const content = element('span', 'flex min-w-0 flex-1 items-center');
        const iconWrap = element('span', 'flex shrink-0 items-center ps-1 pe-1 browser:pe-0');
        const slot = element('span', '-mx-[3px] flex icon-leading-slot size-[var(--height-token-row)] shrink-0 items-center justify-center browser:-mx-0.5');
        const sourceIcon = document.querySelector('[data-app-action-sidebar-project-collapsed="' + String(!open) + '"] svg') || folderIcon;
        slot.append(icon(sourceIcon, 'M2 3h5l2 2h5v8H2Z', 'icon-xs shrink-0', '0 0 16 16'));
        iconWrap.append(slot);
        const name = element('span', 'flex min-w-0 flex-1 items-center gap-2 whitespace-nowrap rounded-md py-1 pe-0 text-start text-base text-default');
        name.append(element('span', 'min-w-0 truncate select-none', project.name));
        content.append(iconWrap, name); row.append(content);
        disclosure(row, open, () => {
          if (open) openProjects.delete(project.id); else openProjects.add(project.id);
          save(); render();
        });
        item.append(row);
        if (open) {
          if (!project.tasks.length) item.append(element('div', 'ps-6 py-1 text-sm text-tertiary', '暂无任务'));
          for (const task of project.tasks) {
            const taskRow = element('button', (classes[7] || 'sidebar-item py-row-y pe-row-y text-sm') + ' flex min-w-0 items-center text-start');
            taskRow.style.paddingInlineStart = 'calc(var(--padding-row-cell-x,var(--padding-row-x)) + 24px)';
            taskRow.type = 'button';
            taskRow.setAttribute('draggable', 'false');
            taskRow.setAttribute('data-new-project-thread-id', task.id);
            taskRow.append(element('span', 'min-w-0 truncate', task.title));
            taskRow.addEventListener('click', () => {
              if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(task.id)) {
                window.postMessage({ type: 'navigate-to-route', path: '/local/' + task.id }, '*');
              }
            });
            item.append(taskRow);
          }
        }
        list.append(item);
      }
      section.append(list);
    }
    next.append(section);
    root?.remove();
    root = next;
    parent.insertBefore(root, native.parentElement);
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; render(); });
  }
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { subtree: true, childList: true });
  const timer = setInterval(schedule, 1000);
  window.__codexControlConsoleNewProjects = {
    version: VERSION,
    set(items) { projects = Array.isArray(items) ? items : []; render(); },
    dispose() { disposed = true; observer.disconnect(); clearInterval(timer); root?.remove(); }
  };
  render();
}

export function buildNativeNewProjectsInjectionScript() {
  return `(${installNativeNewProjects.toString()})()`;
}

export function buildNativeNewProjectsSnapshotScript(projects = []) {
  return `window.__codexControlConsoleNewProjects?.set(${JSON.stringify(projects).replaceAll('<', '\\u003c')})`;
}
