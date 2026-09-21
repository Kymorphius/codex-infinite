import { readNativeSidebarModel } from './native-sidebar-model.mjs';
import { createSourceSidebarRenderer } from './native-sidebar-render.mjs';
import { installSidebarMenu } from './native-sidebar-menu.mjs';

export function installUnifiedSidebar(dashboardUrl, readModel, createRenderer, createMenu) {
  const VERSION = '2026-09-21.owner.5';
  if (window.__codexControlConsoleUnifiedSidebar?.version === VERSION) return;
  window.__codexControlConsoleUnifiedSidebar?.dispose();
  document.querySelectorAll('[data-codex-control-console-unified-list]').forEach(node => node.remove());
  const KEY = 'codex-control-console.unified-sidebar.v1', origin = new URL(dashboardUrl).origin;
  let enabled = false; try { enabled = JSON.parse(localStorage.getItem(KEY) || '{}').enabled === true; } catch {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ enabled })); } catch {} }; save();
  let devices = [], ready = false, pendingRead = false, disposed = false, last = '', frame;
  const pending = new Map(), channel = crypto.randomUUID();
  const control = document.createElement('div'); control.setAttribute('data-codex-control-console-unified-control', '');
  const toggle = document.createElement('button'); toggle.textContent = '统一'; toggle.setAttribute('data-codex-control-console-unified-toggle', '');
  const manage = document.createElement('button'); manage.textContent = '管理'; manage.title = '管理各设备原生分区';
  for (const button of [toggle, manage]) { button.style.cssText = 'border:1px solid #8885;border-radius:6px;padding:3px 7px;font:inherit;font-size:12px;color:inherit;background:var(--color-background-primary,#252525);-webkit-app-region:no-drag'; control.append(button); }
  function request(operation, input) {
    if (!ready) return Promise.reject(Error('侧边栏连接尚未就绪'));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(Error('设备响应超时，请刷新核对')); }, 65000);
      pending.set(id, { resolve, reject, timer }); frame.contentWindow.postMessage({ type: 'codex-sidebar-request', channel, id, operation, input }, origin);
    });
  }
  const menu = createMenu({ request, refresh, getDevices: () => devices });
  const renderer = createRenderer({ readModel, onItem: menu.item, openConversation: (device, record) => {
    window.__codexControlConsoleOpenUnifiedConversation?.({ id: record.id, deviceId: device.device.id, deviceName: device.device.name, title: record.title, cwd: record.cwd });
  } });
  async function refresh() {
    if (!enabled || !ready || pendingRead || disposed) return;
    pendingRead = true;
    try {
      const result = await request('read'); devices = result.devices || [];
      const signature = JSON.stringify(devices);
      if (enabled && (signature !== last || !renderer.connected())) { last = signature; renderer.render(devices); }
      toggle.title = '统一显示各设备的原生分区';
    } catch (error) { toggle.title = error.message; devices = devices.map(value => ({ ...value, status: 'offline', message: error.message })); if (enabled) renderer.render(devices); }
    finally { pendingRead = false; }
  }
  function connect() {
    if (frame) return;
    frame = document.createElement('iframe'); frame.hidden = true; frame.setAttribute('data-codex-sidebar-bridge', ''); frame.src = origin + '/sidebar.html?channel=' + channel; document.body.append(frame);
  }
  function receive(event) {
    if (event.source !== frame?.contentWindow || event.origin !== origin || event.data?.channel !== channel) return;
    if (event.data.type === 'codex-sidebar-ready') { ready = true; void refresh(); return; }
    if (event.data.type !== 'codex-sidebar-response') return;
    const value = pending.get(event.data.id); if (!value) return;
    pending.delete(event.data.id); clearTimeout(value.timer); if (event.data.error) value.reject(Error(event.data.error)); else value.resolve(event.data.result);
  }
  function place() {
    if (disposed) return;
    const newChat = Array.from(document.querySelectorAll('button')).find(node => /^(新聊天|New chat)$/.test(node.textContent?.trim()));
    if (newChat) {
      const rect = newChat.getBoundingClientRect();
      if (control.parentElement !== document.body) document.body.append(control);
      control.style.cssText = 'position:fixed;z-index:60;display:' + (rect.width > 100 && rect.height > 0 ? 'flex' : 'none') + ';gap:3px;left:' + (rect.right - (enabled ? 96 : 52)) + 'px;top:' + (rect.top + Math.max(0, (rect.height - 28) / 2)) + 'px';
    }
    const pressed = String(enabled), background = enabled ? 'var(--color-background-selected,#555)' : 'var(--color-background-primary,#252525)';
    if (toggle.getAttribute('aria-pressed') !== pressed) toggle.setAttribute('aria-pressed', pressed);
    if (toggle.style.background !== background) toggle.style.background = background;
    if (manage.hidden === enabled) manage.hidden = !enabled;
    if (enabled) { document.querySelector('[data-codex-control-console-remote-sidebar]')?.remove(); renderer.place(); }
  }
  toggle.onclick = () => {
    enabled = !enabled; save(); menu.close(); last = '';
    if (enabled) { connect(); void refresh(); } else { renderer.clear(); window.__codexControlConsoleRefreshLegacySidebar?.(); }
    place();
  };
  manage.onclick = menu.manage;
  let scheduled = false;
  const observer = new MutationObserver(() => { if (scheduled) return; scheduled = true; requestAnimationFrame(() => { scheduled = false; place(); }); });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-app-action-sidebar-section-collapsed'] });
  window.addEventListener('message', receive);
  const timer = setInterval(() => { if (enabled) { void refresh(); place(); } }, 5000);
  window.__codexControlConsoleUnifiedSidebar = { version: VERSION, get enabled() { return enabled; }, refresh,
    dispose() { disposed = true; clearInterval(timer); observer.disconnect(); window.removeEventListener('message', receive); renderer.clear(); menu.close(); control.remove(); frame?.remove(); for (const item of pending.values()) { clearTimeout(item.timer); item.reject(Error('连接已重建')); } } };
  if (enabled) connect(); place();
}
export function buildNativeUnifiedSidebarInjectionScript(dashboardUrl) {
  return `(${installUnifiedSidebar.toString()})(${JSON.stringify(dashboardUrl)},${readNativeSidebarModel.toString()},${createSourceSidebarRenderer.toString()},${installSidebarMenu.toString()})`;
}
