import packageMetadata from "../package.json" with { type: "json" };

export function installNativeSidebarRestart(dashboardUrl, productVersion) {
  const VERSION = '2026-09-07.4';
  if (window.__codexControlConsoleSidebarRestart?.version === VERSION) return;
  window.__codexControlConsoleSidebarRestart?.dispose();
  const origin = new URL(dashboardUrl).origin;
  const root = document.createElement('div'); root.setAttribute('data-codex-control-console-sidebar-restart', '');
  root.style.cssText = 'position:fixed;z-index:60;display:none;align-items:center;gap:6px;height:32px;-webkit-app-region:no-drag';
  const version = document.createElement('span'); version.setAttribute('data-codex-control-console-native-version', '');
  version.setAttribute('aria-label', 'Codex Infinite 版本'); version.textContent = 'v' + productVersion;
  version.style.cssText = 'display:inline-flex;height:32px;align-items:center;padding:0 2px;font:500 10px/16px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-variant-numeric:tabular-nums;white-space:nowrap;opacity:.58;pointer-events:none';
  const button = document.createElement('button'); button.type = 'button'; button.textContent = '重启';
  button.title = '重启控制台'; button.setAttribute('aria-label', '重启控制台');
  button.style.cssText = 'height:32px;padding:0 6px;width:auto;font-size:12px;-webkit-app-region:no-drag';
  root.append(version, button); document.body.append(root);
  const spacing = document.createElement('style');
  spacing.textContent = '[data-codex-control-console-restart-spacing]{margin-inline-start:84px !important}'; root.append(spacing);
  let spacingHost = null;
  let frame = null, disposed = false, scheduled = false;
  function close() { frame?.remove(); frame = null; button.setAttribute('aria-expanded', 'false'); }
  function place() {
    if (disposed) return;
    if (!root.isConnected) document.body.append(root);
    const help = document.querySelector('button[aria-label="打开帮助菜单"],button[aria-label="Open help menu"],button[aria-label="Help"]');
    if (spacingHost !== help?.parentElement) { spacingHost?.removeAttribute('data-codex-control-console-restart-spacing'); spacingHost = help?.parentElement; spacingHost?.setAttribute('data-codex-control-console-restart-spacing', ''); }
    const rect = help?.getBoundingClientRect();
    const visible = rect && rect.width > 0 && rect.height > 0;
    root.style.display = visible ? 'flex' : 'none';
    if (!visible) { close(); return; }
    button.className = help.className;
    version.style.color = getComputedStyle(help).color;
    const width = root.getBoundingClientRect?.().width || 76;
    root.style.left = Math.max(4, Math.min(rect.left >= width + 8 ? rect.left - width - 8 : rect.right + 4, window.innerWidth - width - 4)) + 'px'; root.style.top = rect.top + 'px';
    if (frame) { frame.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 368)) + 'px'; frame.style.bottom = Math.max(8, window.innerHeight - rect.top + 8) + 'px'; }
  }
  button.setAttribute('aria-expanded', 'false');
  button.addEventListener('click', () => {
    if (frame) { close(); return; }
    frame = document.createElement('iframe'); frame.title = '确认重启控制台';
    const url = new URL('/restart.html', origin);
    if (getComputedStyle(document.documentElement).colorScheme.includes('dark')) url.searchParams.set('theme', 'dark');
    frame.src = url.href;
    frame.style.cssText = 'position:fixed;z-index:100;width:min(360px,calc(100vw - 16px));height:270px;border:1px solid #8886;border-radius:12px;box-shadow:0 8px 30px #0005;background:transparent;-webkit-app-region:no-drag';
    document.body.append(frame); button.setAttribute('aria-expanded', 'true'); place();
  });
  function onMessage(event) { if (frame && event.source === frame.contentWindow && event.origin === origin && event.data?.type === 'codex-control-console-restart-cancel') close(); }
  function schedule() { if (scheduled || disposed) return; scheduled = true; requestAnimationFrame(() => { scheduled = false; place(); }); }
  const observer = new MutationObserver(schedule); observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('resize', schedule); window.addEventListener('message', onMessage);
  window.__codexControlConsoleSidebarRestart = { version: VERSION, dispose() { disposed = true; observer.disconnect(); window.removeEventListener('resize', schedule); window.removeEventListener('message', onMessage); close(); spacingHost?.removeAttribute('data-codex-control-console-restart-spacing'); root.remove(); } };
  place();
}
export function buildNativeSidebarRestartInjectionScript(dashboardUrl) { const version = /^[0-9A-Za-z.+-]{1,32}$/.test(packageMetadata.version) ? packageMetadata.version : 'unknown'; return `(${installNativeSidebarRestart.toString()})(${JSON.stringify(dashboardUrl)},${JSON.stringify(version)})`; }
