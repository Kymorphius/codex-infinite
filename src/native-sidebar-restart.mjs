import packageMetadata from "../package.json" with { type: "json" };

export function installNativeSidebarRestart(dashboardUrl, productVersion) {
  const VERSION = '2026-09-27.help-menu-restart';
  if (window.__codexControlConsoleSidebarRestart?.version === VERSION) return;
  window.__codexControlConsoleSidebarRestart?.dispose();
  const origin = new URL(dashboardUrl).origin;
  const root = document.createElement('div'); root.setAttribute('data-codex-control-console-sidebar-restart', '');
  root.style.cssText = 'display:flex;flex:0 0 auto;align-items:center;gap:6px;height:28px;-webkit-app-region:no-drag';
  const version = document.createElement('span'); version.setAttribute('data-codex-control-console-native-version', '');
  version.setAttribute('aria-label', 'Codex Infinite 版本'); version.textContent = 'v' + productVersion;
  version.style.cssText = 'display:inline-flex;height:28px;align-items:center;padding:0 2px;font:500 10px/16px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-variant-numeric:tabular-nums;white-space:nowrap;opacity:.58;pointer-events:none';
  const nativeButton = document.createElement('button'); nativeButton.type = 'button'; nativeButton.textContent = '原生';
  nativeButton.title = '启动原生 Codex'; nativeButton.setAttribute('aria-label', '启动原生 Codex');
  const controlStyle = 'height:28px;padding:0 6px;border:0;border-radius:6px;background:transparent;color:inherit;font:500 12px/18px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer;-webkit-app-region:no-drag';
  nativeButton.style.cssText = controlStyle;
  const button = document.createElement('button'); button.type = 'button'; button.textContent = '重启加强版';
  button.title = '重启控制台'; button.setAttribute('aria-label', '重启控制台');
  button.setAttribute('role', 'menuitem'); button.setAttribute('data-codex-control-console-help-restart', '');
  root.append(version, nativeButton);
  let frame = null, disposed = false, scheduled = false;
  function close() { frame?.remove(); frame = null; }
  function place() {
    if (disposed) return;
    const tabs = document.querySelector('[data-codex-control-console-native-tabs]');
    if (!tabs) root.remove();
    else if (root.parentElement !== tabs) tabs.append(root);
    const help = document.querySelector('button[aria-label="打开帮助菜单"],button[aria-label="Open help menu"],button[aria-label="Help menu"],button[aria-label="Help"]');
    const open = help?.getAttribute('aria-expanded') === 'true' || help?.getAttribute('data-state') === 'open';
    const controlled = open ? document.getElementById(help.getAttribute('aria-controls') || '') : null;
    const menu = (controlled?.querySelector('[role="menu"]') || controlled) || (open ? Array.from(document.querySelectorAll('[role="menu"]')).find((candidate) =>
      /Keyboard shortcuts|键盘快捷键|帮助中心|Help/.test(candidate.textContent || '') && candidate.getBoundingClientRect().width > 0) : null);
    if (menu && button.parentElement !== menu) {
      button.className = menu.querySelector('[role="menuitem"]')?.className || '';
      menu.append(button);
    }
    if (frame) {
      const rect = help?.getBoundingClientRect() || button.getBoundingClientRect();
      frame.style.left = Math.max(8, Math.min(rect.right - 360, window.innerWidth - 368)) + 'px';
      frame.style.top = Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 278)) + 'px';
    }
  }
  nativeButton.addEventListener('click', async () => {
    nativeButton.disabled = true;
    try {
      const response = await fetch(new URL('/api/native-app/launch', origin), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      if (!response.ok) throw new Error('原生 Codex 启动失败');
    } catch { nativeButton.title = '无法启动原生 Codex，请检查应用是否已安装'; }
    finally { nativeButton.disabled = false; }
  });
  button.addEventListener('click', () => {
    if (frame) { close(); return; }
    frame = document.createElement('iframe'); frame.title = '确认重启控制台';
    const url = new URL('/restart.html', origin);
    if (getComputedStyle(document.documentElement).colorScheme.includes('dark')) url.searchParams.set('theme', 'dark');
    frame.src = url.href;
    frame.style.cssText = 'position:fixed;z-index:2147483000;width:min(360px,calc(100vw - 16px));height:270px;border:1px solid #8886;border-radius:12px;box-shadow:0 8px 30px #0005;background:transparent;-webkit-app-region:no-drag';
    document.body.append(frame); place();
  });
  function onMessage(event) { if (frame && event.source === frame.contentWindow && event.origin === origin && event.data?.type === 'codex-control-console-restart-cancel') close(); }
  function schedule() { if (scheduled || disposed) return; scheduled = true; requestAnimationFrame(() => { scheduled = false; place(); }); }
  const observer = new MutationObserver(schedule); observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-expanded', 'aria-controls', 'data-state'] });
  window.addEventListener('resize', schedule); window.addEventListener('message', onMessage);
  window.__codexControlConsoleSidebarRestart = { version: VERSION, dispose() { disposed = true; observer.disconnect(); window.removeEventListener('resize', schedule); window.removeEventListener('message', onMessage); close(); button.remove(); root.remove(); } };
  place();
}
export function buildNativeSidebarRestartInjectionScript(dashboardUrl) { const version = /^[0-9A-Za-z.+-]{1,32}$/.test(packageMetadata.version) ? packageMetadata.version : 'unknown'; return `(${installNativeSidebarRestart.toString()})(${JSON.stringify(dashboardUrl)},${JSON.stringify(version)})`; }
