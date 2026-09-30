// This helper is serialized into the native page; keep every dependency local.
export function installNativeSidebarModuleEntries(documentRef, anchor, definitions, icons, openModule) {
  const parent = anchor?.parentElement;
  if (!parent || anchor.closest?.('nav[data-app-navigation-rail]')) return [];
  const checklist = documentRef.querySelector('[data-ccc-general-checklist-entry]');
  const fallback = ['[data-codex-control-console-open-local-project]', '[data-codex-control-console-butler-entry]', '[data-sidebar-destination="builtin:orbit"]']
    .map(selector => Array.from(documentRef.querySelectorAll(selector)).find(node => node.parentElement === parent)).find(Boolean);
  let previous = checklist?.parentElement === parent ? checklist : fallback || anchor;
  const selectedClasses = /^(?:bg-primary-ghost-hover|bg-text-info\/10|text-info|text-emphasis|text-codex-icon-active|(?:is-)?selected|(?:is-)?active)$/;
  const className = String(anchor.className || '').split(/\s+/).filter(value => value && !selectedClasses.test(value)).join(' ');
  const outerStyle = 'display:flex;align-items:center;min-width:0;width:100%;white-space:nowrap;text-align:start;';
  const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const setAttribute = (node, name, value) => { if (node.getAttribute(name) !== value) node.setAttribute(name, value); };
  const entries = [];
  for (const definition of definitions) {
    const selector = '[' + definition.attribute + ']';
    const existing = Array.from(documentRef.querySelectorAll(selector));
    let entry = existing[0];
    const created = !entry;
    if (created) entry = documentRef.createElement('button');
    for (const duplicate of existing.slice(1)) duplicate.remove();
    setAttribute(entry, 'type', 'button');
    setAttribute(entry, definition.attribute, '');
    setAttribute(entry, 'data-ccc-sidebar-module-entry', '');
    setAttribute(entry, 'aria-label', definition.text);
    if (entry.className !== className) entry.className = className;
    // CSSOM normalizes cssText, so compare against the saved normalized value.
    if (entry.__cccSidebarModuleStyleSource !== outerStyle || entry.style.cssText !== entry.__cccSidebarModuleStyleRendered) {
      entry.style.cssText = outerStyle;
      entry.__cccSidebarModuleStyleSource = outerStyle;
      entry.__cccSidebarModuleStyleRendered = entry.style.cssText;
    }
    const markup = '<div class="flex min-w-0 items-center gap-nav-row-content text-base flex-1" style="display:flex;min-width:0;align-items:center;gap:var(--spacing-nav-row-content,8px);flex:1">'
      + '<span class="flex icon-leading-slot min-w-[var(--icon-leading-size)] shrink-0 items-center justify-center" aria-hidden="true" style="display:flex;align-items:center;justify-content:center;min-width:var(--icon-leading-size,1.1rem);flex-shrink:0">'
      + (icons[definition.module] || '') + '</span>'
      + '<span class="text-fade-truncate" style="display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escape(definition.text) + '</span></div>';
    if (entry.__cccSidebarModuleMarkupSource !== markup || entry.innerHTML !== entry.__cccSidebarModuleMarkupRendered) {
      entry.innerHTML = markup;
      entry.__cccSidebarModuleMarkupSource = markup;
      entry.__cccSidebarModuleMarkupRendered = entry.innerHTML;
    }
    if (created) {
      entry.__cccSidebarModuleOpen = openModule;
      entry.addEventListener('click', event => {
        event.preventDefault(); event.stopPropagation();
        entry.__cccSidebarModuleOpen(definition.module);
      });
    } else if (entry.__cccSidebarModuleOpen) entry.__cccSidebarModuleOpen = openModule;
    if (entry.parentElement !== parent || entry.previousElementSibling !== previous) parent.insertBefore(entry, previous.nextSibling);
    entries.push(entry); previous = entry;
  }
  return entries;
}
