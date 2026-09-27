export function installNativeSidebarRestart(dashboardBinding) {
  const VERSION = '2026-09-27.windows-help-host-actions';
  if (window.__codexControlConsoleSidebarRestart?.version === VERSION) return;
  window.__codexControlConsoleSidebarRestart?.dispose();
  if (!dashboardBinding) return;
  const originalButton = document.createElement('button');
  originalButton.type = 'button'; originalButton.textContent = '启动原版';
  originalButton.setAttribute('aria-label', '启动原版');
  originalButton.setAttribute('role', 'menuitem');
  originalButton.setAttribute('data-codex-control-console-help-original', '');
  const button = document.createElement('button');
  button.type = 'button'; button.textContent = '重启加强版';
  button.setAttribute('aria-label', '重启加强版');
  button.setAttribute('role', 'menuitem');
  button.setAttribute('data-codex-control-console-help-restart', '');
  let disposed = false, scheduled = false;
  function place() {
    if (disposed) return;
    const help = Array.from(document.querySelectorAll('#application-menu-trigger-help-menu,button[aria-label="帮助菜单"],button[aria-label="打开帮助菜单"],button[aria-label="Open help menu"],button[aria-label="Help menu"]')).find(candidate =>
      candidate.getAttribute('aria-expanded') === 'true' || candidate.getAttribute('data-state') === 'open');
    const open = help?.getAttribute('aria-expanded') === 'true' || help?.getAttribute('data-state') === 'open';
    const controlled = open ? document.getElementById(help.getAttribute('aria-controls') || '') : null;
    const menu = (controlled?.querySelector('[role="menu"]') || controlled) || (open ? Array.from(document.querySelectorAll('[role="menu"]')).find(candidate =>
      (candidate.getAttribute('aria-labelledby') === help.id || /Keyboard shortcuts|键盘快捷键/.test(candidate.textContent || '')) && candidate.getBoundingClientRect().width > 0) : null);
    if (!menu) { originalButton.remove(); button.remove(); return; }
    const itemClass = menu.querySelector('[role="menuitem"]:not([data-codex-control-console-help-original]):not([data-codex-control-console-help-restart])')?.className || '';
    if (originalButton.className !== itemClass) originalButton.className = itemClass;
    if (button.className !== itemClass) button.className = itemClass;
    if (originalButton.parentElement !== menu || button.parentElement !== menu || originalButton.nextElementSibling !== button || menu.lastElementChild !== button) {
      originalButton.remove(); button.remove();
      menu.append(originalButton);
      menu.append(button);
    }
  }
  originalButton.addEventListener('click', () => {
    if (typeof window[dashboardBinding] === 'function') window[dashboardBinding](JSON.stringify({ module: 'original' }));
  });
  button.addEventListener('click', () => {
    if (typeof window[dashboardBinding] !== 'function') return;
    if (window.confirm('重启当前设备的加强版 ChatGPT？正在执行的任务可能被中断。')) {
      window[dashboardBinding](JSON.stringify({ module: 'restart', confirm: true }));
    }
  });
  function schedule() { if (scheduled || disposed) return; scheduled = true; requestAnimationFrame(() => { scheduled = false; place(); }); }
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-expanded', 'aria-controls', 'data-state'] });
  window.__codexControlConsoleSidebarRestart = { version: VERSION, dispose() { disposed = true; observer.disconnect(); originalButton.remove(); button.remove(); } };
  place();
}

export function buildNativeSidebarRestartInjectionScript(_dashboardUrl, dashboardBinding = '') {
  return `(${installNativeSidebarRestart.toString()})(${JSON.stringify(dashboardBinding)})`;
}
