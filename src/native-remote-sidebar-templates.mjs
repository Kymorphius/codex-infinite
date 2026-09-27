// Native rows exist only while a native section is expanded. Keep the last captured
// template and fall back to native-equivalent markup, so a refresh with every native
// section collapsed never renders unstyled remote rows.
export function createNativeRemoteTemplates(documentRef, findProjectsSection) {
  const fallback = {
    sectionClass: 'relative px-row-x group/nav-section',
    projectClass: 'group relative cursor-interaction text-sm hover:bg-primary-ghost-hover h-[var(--height-token-row)] sidebar-item sidebar-row-focus flex items-center justify-between overflow-hidden text-default',
    threadClass: 'group relative cursor-interaction text-sm h-[var(--height-token-row)] sidebar-item sidebar-row-focus flex items-center overflow-hidden text-default'
  };
  const cache = {};
  const make = (tag, className, text) => { const node = documentRef.createElement(tag); node.className = className; if (text) node.textContent = text; return node; };
  function projectContent() {
    const content = make('div', 'flex min-w-0 flex-1 items-center');
    const iconWrap = make('div', 'flex shrink-0 items-center ps-1 pe-1 browser:pe-0');
    const slot = make('span', '-mx-[3px] flex icon-leading-slot size-[var(--height-token-row)] shrink-0 items-center justify-center browser:-mx-0.5');
    const svg = documentRef.createElementNS('http://www.w3.org/2000/svg', 'svg'), path = documentRef.createElementNS('http://www.w3.org/2000/svg', 'path');
    for (const [name, value] of [['viewBox', '0 0 16 16'], ['width', '16'], ['height', '16'], ['class', 'icon-xs shrink-0'], ['aria-hidden', 'true']]) svg.setAttribute(name, value);
    for (const [name, value] of [['d', 'M2 4.5A1.5 1.5 0 0 1 3.5 3h2.6l1.4 1.5h5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5Z'], ['fill', 'none'], ['stroke', 'currentColor'], ['stroke-width', '1.2']]) path.setAttribute(name, value);
    svg.append(path); slot.append(svg); iconWrap.append(slot);
    const label = make('div', 'flex min-w-0 flex-1 items-center gap-2 whitespace-nowrap rounded-md py-1 pe-0 text-start text-base text-default');
    label.append(make('span', 'min-w-0 truncate', '…'));
    content.append(iconWrap, label); return content;
  }
  function threadContent() {
    const content = make('div', 'flex h-full w-full min-w-0 items-center py-row-y pe-row-y ps-2 text-base');
    const title = make('span', 'flex min-w-0 flex-1 items-center'); title.setAttribute('data-thread-title-trigger', '');
    content.append(title); return content;
  }
  return function read() {
    const projects = findProjectsSection();
    const heading = projects?.querySelector('[data-app-action-sidebar-section-toggle]');
    const project = projects?.querySelector('[data-app-action-sidebar-project-row]') || documentRef.querySelector('[data-app-action-sidebar-project-row]');
    const thread = documentRef.querySelector('[data-app-action-sidebar-thread-id]:not([data-app-action-sidebar-thread-selected="true"])') || documentRef.querySelector('[data-app-action-sidebar-thread-id]');
    const live = {
      sectionClass: projects?.className || '',
      headingClass: heading?.className || '',
      headingContainerClass: heading?.parentElement?.parentElement?.parentElement?.className || '',
      headingTextClass: heading?.parentElement?.parentElement?.className || '',
      projectClass: project?.className || '',
      projectContent: project?.firstElementChild?.cloneNode(true) || null,
      threadClass: String(thread?.className || '').split(/\s+/).filter(token => token !== 'bg-primary-ghost-hover').join(' '),
      threadContent: Array.from(thread?.children || []).find(child => child.classList?.contains('flex') && child.classList?.contains('h-full'))?.cloneNode(true) || null,
      projectIcon: project?.firstElementChild?.querySelector('svg')?.cloneNode(true) || null
    };
    for (const [key, value] of Object.entries(live)) if (value) cache[key] = value;
    return { ...cache,
      sectionClass: cache.sectionClass || fallback.sectionClass,
      projectClass: cache.projectClass || fallback.projectClass,
      threadClass: cache.threadClass || fallback.threadClass,
      projectContent: cache.projectContent || projectContent(),
      threadContent: cache.threadContent || threadContent(),
      projectIcon: cache.projectIcon || null };
  };
}
