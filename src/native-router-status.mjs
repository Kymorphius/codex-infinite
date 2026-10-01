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
  const VERSION = '2026-10-01.router-status-rail';
  if (window.__codexControlConsoleRouterStatus?.version === VERSION) return;
  window.__codexControlConsoleRouterStatus?.dispose();
  const COLORS = { ready: '#29a568', degraded: '#d99a1e', unknown: '#d99a1e', stopped: '#d64545', 'not-installed': '#d64545', disabled: '#8a8a8a' };
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('data-codex-control-console-router-status', '');
  button.style.cssText = 'position:relative;flex:0 0 auto;-webkit-app-region:no-drag;app-region:no-drag';
  button.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3" y="13" width="18" height="7" rx="2"></rect><path d="M7 16.5h.01M11 16.5h.01"></path><path d="M8.5 9.5a5 5 0 0 1 7 0M6 7a8.5 8.5 0 0 1 12 0"></path></svg><span data-router-dot style="position:absolute;top:6px;right:6px;width:7px;height:7px;border-radius:50%;box-shadow:0 0 0 2px var(--color-token-main-surface-primary,#1f1f1f)"></span>';
  let state = { status: 'unknown', title: 'Router：正在读取状态', repair: null, confirm: null }, disposed = false, busy = false, scheduled = false;
  const ask = (kind) => { if (typeof window[bindingName] === 'function') window[bindingName](JSON.stringify({ kind })); };
  function render() {
    button.title = state.message ? `${state.title}\n${state.message}` : state.title;
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
    if (button.nextElementSibling !== profile || button.parentElement !== rail) rail.insertBefore(button, profile);
  }
  function schedule() { if (scheduled || disposed) return; scheduled = true; requestAnimationFrame(() => { scheduled = false; place(); }); }
  button.addEventListener('click', () => {
    if (!state.repair || busy || !window.confirm(state.confirm)) return;
    busy = true; render(); ask('repair');
  });
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  const timer = setInterval(() => { if (document.visibilityState !== 'hidden') ask('status'); }, 15000);
  window.__codexControlConsoleRouterStatus = {
    version: VERSION,
    apply(next) { if (next && typeof next === 'object') { state = next; busy = false; render(); } },
    dispose() { disposed = true; observer.disconnect(); clearInterval(timer); button.remove(); }
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
