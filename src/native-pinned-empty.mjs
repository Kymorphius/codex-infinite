export function installNativePinnedEmpty() {
  const VERSION = '2026-09-05.2';
  if (window.__codexControlConsolePinnedEmpty?.version === VERSION) return;
  window.__codexControlConsolePinnedEmpty?.dispose();
  const ATTR = 'data-codex-control-console-pinned-empty';
  document.querySelectorAll('[' + ATTR + ']').forEach(node => node.remove());
  let root, disposed = false, pending = false, signature = '';
  const make = (tag, cls, text) => {
    const node = document.createElement(tag); node.className = cls || '';
    if (text != null) node.textContent = text;
    return node;
  };
  function render() {
    if (disposed) return;
    const sections = [...document.querySelectorAll('section[data-app-action-sidebar-section-heading]')];
    const pinned = sections.find(section => ['pinned', '置顶', '已置顶'].includes(String(section.getAttribute('data-app-action-sidebar-section-heading')).toLowerCase()));
    if (pinned) { root?.remove(); root = null; signature = ''; return; }
    const native = sections.find(section => section.getAttribute('data-app-action-sidebar-section-heading') === 'Projects');
    const parent = native?.parentElement?.parentElement;
    if (!parent) return;
    const heading = native.querySelector('[class*="nav-section-title"]');
    const classes = [native.className, heading?.className, heading?.firstElementChild?.className];
    const next = JSON.stringify(classes);
    if (root?.parentElement === parent && signature === next) return;
    signature = next; root?.remove();
    root = make('div'); root.setAttribute(ATTR, ''); root.style.order = '1';
    const section = make('section', classes[0] || 'relative px-row-x'); section.setAttribute('aria-label', '置顶');
    const title = make('div', classes[1] || 'flex items-center ps-2');
    title.append(make('div', classes[2] || 'text-base font-medium text-tertiary', '置顶'));
    section.append(title, make('div', 'px-2 py-2 text-sm text-tertiary', '右键项目或会话，选择“置顶”'));
    root.append(section); parent.insertBefore(root, native.parentElement);
  }
  const observer = new MutationObserver(() => {
    if (pending || disposed) return; pending = true;
    requestAnimationFrame(() => { pending = false; render(); });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.__codexControlConsolePinnedEmpty = { version: VERSION, dispose() { disposed = true; observer.disconnect(); root?.remove(); } };
  render();
}
export function buildNativePinnedEmptyInjectionScript() { return `(${installNativePinnedEmpty.toString()})()`; }
