// Presentation-only entry; project data and actions stay in the loopback page.
export function installNativeProjectManagementEntry(openProjects, documentRef = document) {
  const attribute = 'data-codex-control-console-projects-entry';
  const search = documentRef.querySelector('button[aria-label="搜索"],button[aria-label="Search"]');
  const host = search?.parentElement?.parentElement?.parentElement;
  if (!host?.classList?.contains('ms-auto')) return null;
  let entry = documentRef.querySelector('[' + attribute + ']');
  if (!entry) {
    entry = documentRef.createElement('button');
    entry.type = 'button';
    entry.setAttribute(attribute, '');
    entry.setAttribute('aria-label', '项目管理');
    entry.title = '项目管理 · 平铺所有项目';
    entry.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>';
    entry.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;flex:0 0 28px;width:28px;height:28px;padding:0;border:0;border-radius:7px;background:transparent;color:inherit;cursor:pointer;';
    entry.style.setProperty('-webkit-app-region', 'no-drag', 'important');
    entry.style.setProperty('app-region', 'no-drag', 'important');
    entry.style.setProperty('pointer-events', 'auto', 'important');
    entry.addEventListener('mouseenter', () => { entry.style.background = 'color-mix(in srgb,currentColor 10%,transparent)'; });
    entry.addEventListener('mouseleave', () => { entry.style.background = 'transparent'; });
    entry.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation(); openProjects();
    });
  }
  if (entry.parentElement !== host) {
    const settings = host.querySelector('[data-codex-control-console-native-turbo-settings]');
    host.insertBefore(entry, settings?.nextSibling || host.firstChild);
  }
  return entry;
}
