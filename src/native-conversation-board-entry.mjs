// Presentation-only entry; conversation data and opening stay in the loopback page.
export function installNativeConversationBoardEntry(openBoard, documentRef = document) {
  const attribute = 'data-codex-control-console-conversations-entry';
  const search = documentRef.querySelector('button[aria-label="搜索"],button[aria-label="Search"]');
  const host = search?.parentElement?.parentElement?.parentElement;
  if (!host?.classList?.contains('ms-auto')) return null;
  let entry = documentRef.querySelector('[' + attribute + ']');
  if (!entry) {
    entry = documentRef.createElement('button');
    entry.type = 'button'; entry.setAttribute(attribute, ''); entry.setAttribute('aria-label', '会话看板');
    entry.title = '会话看板 · 管理 ChatGPT 和 Codex 会话';
    entry.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="10" rx="1.5"/><rect x="17" y="4" width="4" height="13" rx="1.5"/></svg>';
    entry.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;flex:0 0 28px;width:28px;height:28px;padding:0;border:0;border-radius:7px;background:transparent;color:inherit;cursor:pointer;';
    for (const name of ['-webkit-app-region', 'app-region', 'pointer-events']) entry.style.setProperty(name, name === 'pointer-events' ? 'auto' : 'no-drag', 'important');
    entry.addEventListener('mouseenter', () => { entry.style.background = 'color-mix(in srgb,currentColor 10%,transparent)'; });
    entry.addEventListener('mouseleave', () => { entry.style.background = 'transparent'; });
    entry.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); openBoard(); });
  }
  if (entry.parentElement !== host) {
    const projects = host.querySelector('[data-codex-control-console-projects-entry]');
    host.insertBefore(entry, projects?.nextSibling || host.firstChild);
  }
  return entry;
}
