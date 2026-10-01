import { confirmRestart } from './index.js';

const LABELS = { ready: '运行中', degraded: '异常', stopped: '已停止', disabled: '已停用', 'not-installed': '未安装', unknown: '未知' };
const CONFIRM = {
  bootstrap: { title: '启动 Router', action: '启动', message: 'Router 服务未加载，重新加载 LaunchAgent 并启动？' },
  kickstart: { title: '重启 Router', action: '重启', message: 'Router 无响应，强制重启 Router？\n正在进行的模型请求会被中断。' }
};

export function routerStatusTitle(snapshot) {
  const lines = [`Router：${LABELS[snapshot.status] || LABELS.unknown}`];
  if (snapshot.reason) lines.push(snapshot.reason);
  if (snapshot.health?.version) lines.push(`版本 ${snapshot.health.version}`);
  if (snapshot.service?.state) lines.push(`launchd：${snapshot.service.state}${snapshot.service.pid ? ` (pid ${snapshot.service.pid})` : ''}`);
  const last = snapshot.lastRepair;
  if (last) lines.push(`最近${last.trigger === 'auto' ? '自动' : '手动'}${last.action === 'kickstart' ? '重启' : '启动'}：${new Date(last.at).toLocaleString()} ${last.ok ? '成功' : `失败 ${last.message || ''}`}`);
  if (snapshot.repair) lines.push(`点击${CONFIRM[snapshot.repair].action} Router`);
  return lines.join('\n');
}

export function renderRouterStatus(pill, snapshot) {
  const status = LABELS[snapshot?.status] ? snapshot.status : 'unknown';
  pill.hidden = false;
  pill.dataset.routerState = status;
  pill.querySelector('[data-router-label]').textContent = LABELS[status];
  pill.title = snapshot ? routerStatusTitle(snapshot) : 'Router 状态读取失败';
  pill.setAttribute('aria-disabled', String(!snapshot?.repair));
  pill.setAttribute('aria-label', pill.title.split('\n')[0]);
}

export function installRouterStatus({ pill, showToast, fetchImpl = fetch, confirmImpl = confirmRestart, documentImpl = document,
  intervalMs = 15000, schedule = (fn, ms) => setInterval(fn, ms) }) {
  if (!pill) return null;
  let snapshot = null, busy = false;
  const refresh = async () => {
    try {
      const response = await fetchImpl('/api/router/status', { cache: 'no-store' });
      snapshot = response.ok ? await response.json() : null;
    } catch { snapshot = null; }
    renderRouterStatus(pill, snapshot);
    return snapshot;
  };
  pill.addEventListener('click', async () => {
    const plan = CONFIRM[snapshot?.repair];
    if (!plan || busy) return;
    busy = true;
    try {
      if (!await confirmImpl(plan.message, documentImpl, plan)) return;
      const response = await fetchImpl('/api/router/repair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: true }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw Error(result.message || 'Router 修复失败');
      snapshot = result;
      showToast(result.lastRepair?.ok === false ? `Router ${plan.action}失败：${result.lastRepair.message || ''}` : `Router 已${plan.action}，状态：${LABELS[result.status] || '未知'}`);
    } catch (error) { showToast(error.message); }
    finally { busy = false; renderRouterStatus(pill, snapshot); }
  });
  void refresh();
  schedule(() => { if (documentImpl.visibilityState !== 'hidden') void refresh(); }, intervalMs);
  return { refresh };
}
