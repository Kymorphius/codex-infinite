// Router status button at the bottom of the native ChatGPT sidebar rail, above the profile button.
// The page asks the backend through a CDP binding; the backend answers with a
// presented snapshot, so the page never talks to the router or launchd itself.
export const NATIVE_ROUTER_STATUS_BINDING = '__codexControlConsoleRouterStatusBridge';

const LABELS = { ready: '运行中', degraded: '异常', stopped: '已停止', disabled: '已停用', 'not-installed': '未安装', unknown: '未知' };
const ACTIONS = { bootstrap: '启动', kickstart: '重启' };
const CONFIRMS = { bootstrap: 'Router 服务未加载，重新加载 LaunchAgent 并启动？', kickstart: 'Router 无响应，强制重启 Router？正在进行的模型请求会被中断。' };

export function presentRouterStatus(snapshot) {
  if (!snapshot) return { status: 'unknown', title: 'Router：状态读取失败', repair: null, confirm: null };
  const status = LABELS[snapshot.status] ? snapshot.status : 'unknown';
  const lines = [`Router：${LABELS[status]}`];
  if (snapshot.reason) lines.push(snapshot.reason);
  if (snapshot.health?.version) lines.push(`版本 ${snapshot.health.version}`);
  if (snapshot.service?.state) lines.push(`launchd：${snapshot.service.state}${snapshot.service.pid ? ` (pid ${snapshot.service.pid})` : ''}`);
  const last = snapshot.lastRepair;
  if (last) lines.push(`最近${last.trigger === 'auto' ? '自动' : '手动'}${ACTIONS[last.action] || ''}：${last.ok ? '成功' : `失败 ${last.message || ''}`}`);
  const repair = ACTIONS[snapshot.repair] ? snapshot.repair : null;
  if (repair) lines.push(`点击${ACTIONS[repair]} Router`);
  return { status, title: lines.join('\n'), repair, confirm: repair ? CONFIRMS[repair] : null };
}

export function parseRouterStatusRequest(payload) {
  try {
    const value = JSON.parse(payload);
    return value && ['status', 'repair'].includes(value.kind) && Object.keys(value).every((key) => key === 'kind') ? value : null;
  } catch { return null; }
}

export async function respondToNativeRouterStatusBinding(payload, connection, supervisor) {
  const request = parseRouterStatusRequest(payload);
  if (!request || !supervisor) return null;
  let snapshot = null, message = null;
  try { snapshot = request.kind === 'repair' ? await supervisor.repair() : await supervisor.read(); }
  catch (error) { message = String(error?.message || 'Router 状态读取失败').slice(0, 200); snapshot = supervisor.snapshot ?? null; }
  const response = { ...presentRouterStatus(snapshot), message };
  await connection.evaluate(`window.__codexControlConsoleRouterStatus?.apply(${JSON.stringify(response)})`);
  return response;
}

export function installNativeRouterStatus(bindingName) {
  const VERSION = '2026-10-01.router-status-rail-tooltip';
  if (window.__codexControlConsoleRouterStatus?.version === VERSION) return;
  window.__codexControlConsoleRouterStatus?.dispose();
  const COLORS = { ready: '#29a568', degraded: '#d99a1e', unknown: '#d99a1e', stopped: '#d64545', 'not-installed': '#d64545', disabled: '#8a8a8a' };
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('data-codex-control-console-router-status', '');
  button.style.cssText = 'position:relative;flex:0 0 auto;-webkit-app-region:no-drag;app-region:no-drag';
  // Inner span mirrors the native _ButtonInner wrapper (centers the icon); the dot matches native 8px rail badges.
  button.innerHTML = '<span data-router-inner><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3" y="13" width="18" height="7" rx="2"></rect><path d="M7 16.5h.01M11 16.5h.01"></path><path d="M8.5 9.5a5 5 0 0 1 7 0M6 7a8.5 8.5 0 0 1 12 0"></path></svg></span><span data-router-dot style="position:absolute;top:4px;right:4px;width:8px;height:8px;border-radius:50%;pointer-events:none"></span>';
  // Native rail tooltips are Radix popovers, not title attributes; this mirrors their look.
  const tooltip = document.createElement('div');
  tooltip.setAttribute('role', 'tooltip');
  tooltip.setAttribute('data-codex-control-console-router-tooltip', '');
  tooltip.style.cssText = 'position:fixed;z-index:2147483000;display:none;max-width:20rem;padding:5px 12px;border:1px solid var(--color-border-tooltip,rgba(255,255,255,.12));border-radius:16px;background:var(--color-background-tooltip,#2b2b2b);color:var(--color-text-tooltip,#fff);box-shadow:var(--shadow-tooltip,0 4px 16px rgba(0,0,0,.24));font-size:14px;line-height:18px;white-space:pre-line;text-align:left;pointer-events:none;user-select:none';
  let state = { status: 'unknown', title: 'Router：正在读取状态', repair: null, confirm: null }, disposed = false, busy = false, scheduled = false;
  const ask = (kind) => { if (typeof window[bindingName] === 'function') window[bindingName](JSON.stringify({ kind })); };
  let hovering = false;
  function showTooltip() {
    if (!hovering || !button.isConnected) { tooltip.style.display = 'none'; return; }
    if (tooltip.parentElement !== document.body) document.body.append(tooltip);
    tooltip.style.display = 'block';
    const rect = button.getBoundingClientRect();
    tooltip.style.left = `${Math.round(rect.right + 6)}px`;
    tooltip.style.top = `${Math.round(Math.max(8, Math.min(innerHeight - tooltip.offsetHeight - 8, rect.top + rect.height / 2 - tooltip.offsetHeight / 2)))}px`;
  }
  function render() {
    tooltip.textContent = state.message ? `${state.title}\n${state.message}` : state.title;
    showTooltip();
    button.setAttribute('aria-label', state.title.split('\n')[0]);
    button.dataset.routerState = state.status;
    button.style.cursor = state.repair && !busy ? 'pointer' : 'default';
    button.querySelector('[data-router-dot]').style.background = COLORS[state.status] || COLORS.unknown;
  }
  const NATIVE_LOOK = ['class', 'data-color', 'data-variant', 'data-squircle', 'data-uniform', 'data-size', 'data-icon-size'];
  function place() {
    if (disposed) return;
    const rail = document.querySelector('nav[class*="group/sidebar-rail"]');
    const profile = rail && Array.from(rail.children).filter((child) => child !== button).at(-1);
    const sample = rail?.querySelector('[class*="group/nav-list"] button[data-variant]');
    if (!profile || !sample) { button.remove(); return; }
    for (const name of NATIVE_LOOK) {
      const value = sample.getAttribute(name);
      if (value === null) button.removeAttribute(name); else if (button.getAttribute(name) !== value) button.setAttribute(name, value);
    }
    const inner = button.querySelector('[data-router-inner]'), innerClass = sample.querySelector(':scope > span')?.className || '';
    if (inner.className !== innerClass) inner.className = innerClass;
    if (button.nextElementSibling !== profile || button.parentElement !== rail) rail.insertBefore(button, profile);
  }
  function schedule() { if (scheduled || disposed) return; scheduled = true; requestAnimationFrame(() => { scheduled = false; place(); }); }
  const hover = (value) => () => { hovering = value; showTooltip(); };
  button.addEventListener('mouseenter', hover(true)); button.addEventListener('focus', hover(true));
  button.addEventListener('mouseleave', hover(false)); button.addEventListener('blur', hover(false));
  button.addEventListener('click', () => {
    hovering = false; showTooltip();
    if (!state.repair || busy || !window.confirm(state.confirm)) return;
    busy = true; render(); ask('repair');
  });
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  const timer = setInterval(() => { if (document.visibilityState !== 'hidden') ask('status'); }, 15000);
  window.__codexControlConsoleRouterStatus = {
    version: VERSION,
    apply(next) { if (next && typeof next === 'object') { state = next; busy = false; render(); } },
    dispose() { disposed = true; observer.disconnect(); clearInterval(timer); button.remove(); tooltip.remove(); }
  };
  render(); place(); ask('status');
}

/** Extra-binding descriptor understood by CodexInjector. */
export function createNativeRouterStatusBinding(supervisor) {
  return {
    name: NATIVE_ROUTER_STATUS_BINDING,
    source: `(${installNativeRouterStatus.toString()})(${JSON.stringify(NATIVE_ROUTER_STATUS_BINDING)})`,
    handle: (payload, connection) => respondToNativeRouterStatusBinding(payload, connection, supervisor)
  };
}
