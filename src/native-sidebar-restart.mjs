export function installNativeSidebarRestart(dashboardBinding) {
  const VERSION = '2026-09-27.current-host-restart';
  if (window.__codexControlConsoleSidebarRestart?.version === VERSION) return;
  window.__codexControlConsoleSidebarRestart?.dispose();
  if (!dashboardBinding) return;
  const button = document.createElement('button');
  button.type = 'button'; button.textContent = '重启加强版';
  button.setAttribute('aria-label', '重启加强版');
  button.setAttribute('role', 'menuitem');
  button.setAttribute('data-codex-control-console-help-restart', '');
  let disposed = false, scheduled = false;
  function place() {
    if (disposed) return;
    const help = document.querySelector('button[aria-label="帮助菜单"],button[aria-label="打开帮助菜单"],button[aria-label="Open help menu"],button[aria-label="Help menu"]');
    const open = help?.getAttribute('aria-expanded') === 'true' || help?.getAttribute('data-state') === 'open';
    const controlled = open ? document.getElementById(help.getAttribute('aria-controls') || '') : null;
    const menu = (controlled?.querySelector('[role="menu"]') || controlled) || (open ? Array.from(document.querySelectorAll('[role="menu"]')).find(candidate =>
      /Keyboard shortcuts|键盘快捷键/.test(candidate.textContent || '') && candidate.getBoundingClientRect().width > 0) : null);
    if (!menu) { button.remove(); return; }
    if (button.parentElement !== menu) {
      button.className = menu.querySelector('[role="menuitem"]')?.className || '';
      menu.append(button);
    }
  }
  button.addEventListener('click', () => {
    if (typeof window[dashboardBinding] !== 'function') return;
    if (window.confirm('重启当前设备的加强版 ChatGPT？正在执行的任务可能被中断。')) {
      window[dashboardBinding](JSON.stringify({ module: 'restart', confirm: true }));
    }
  });
  function schedule() { if (scheduled || disposed) return; scheduled = true; requestAnimationFrame(() => { scheduled = false; place(); }); }
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-expanded', 'aria-controls', 'data-state'] });
  window.__codexControlConsoleSidebarRestart = { version: VERSION, dispose() { disposed = true; observer.disconnect(); button.remove(); } };
  place();
}

export function buildNativeSidebarRestartInjectionScript(_dashboardUrl, dashboardBinding = '') {
  return `(${installNativeSidebarRestart.toString()})(${JSON.stringify(dashboardBinding)})`;
}
