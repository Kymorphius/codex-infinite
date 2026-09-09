export function buildEmbeddedFrameRecoveryInjectionSource() {
  return `
  const FRAME_READY_TYPE = 'codex-control-console-ready';
  const FRAME_RECOVERY_KEY = 'codex-control-console.frame-recovery.v1';
  const FRAME_LOADING_ATTRIBUTE = 'data-codex-control-console-frame-loading';
  let frameRecoverySchedulePending = false;
  let pendingFrameRecovery = (() => {
    try {
      const value = JSON.parse(sessionStorage.getItem(FRAME_RECOVERY_KEY) || 'null');
      if (value && ['board', 'console', 'sessions', 'priority'].includes(value.module) && Date.now() - Number(value.at) < 30000) return value;
      sessionStorage.removeItem(FRAME_RECOVERY_KEY);
    } catch { try { sessionStorage.removeItem(FRAME_RECOVERY_KEY); } catch {} }
    return null;
  })();

  function monitorEmbeddedFrame(openingFrame, currentFrame, loading, module) {
    openingFrame.addEventListener('load', () => {
      if (loading.isConnected) loading.textContent = '正在连接控制台…';
    }, { once: true });
    setTimeout(() => {
      if (currentFrame() !== openingFrame || !openingFrame.isConnected || openingFrame.hasAttribute('data-codex-control-console-frame-ready')) return;
      if (pendingFrameRecovery) {
        if (loading.isConnected) loading.textContent = '控制台仍被浏览器拦截，请重启专用外壳。';
        return;
      }
      const recovery = { module: ['board', 'console', 'sessions', 'priority'].includes(module) ? module : 'board', at: Date.now() };
      try {
        sessionStorage.setItem(FRAME_RECOVERY_KEY, JSON.stringify(recovery));
        pendingFrameRecovery = recovery;
        openingFrame.setAttribute('data-codex-control-console-frame-recovery-request', String(recovery.at));
        if (loading.isConnected) loading.textContent = '正在自动恢复控制台…';
      } catch {
        if (loading.isConnected) loading.textContent = '无法自动恢复控制台，请重启专用外壳。';
      }
    }, 2000);
    setTimeout(() => {
      if (loading.isConnected) loading.textContent = '控制台页面仍在加载，请确认 127.0.0.1:47831 可用。';
    }, 5000);
  }

  function acceptEmbeddedFrameReady(event, currentFrame) {
    if (event.origin !== DASHBOARD_ORIGIN || event.source !== currentFrame?.contentWindow) return;
    currentFrame.setAttribute('data-codex-control-console-frame-ready', '');
    currentFrame.dispatchEvent(new Event(FRAME_READY_TYPE));
    document.querySelector('[' + FRAME_LOADING_ATTRIBUTE + ']')?.remove();
    try { sessionStorage.removeItem(FRAME_RECOVERY_KEY); } catch {}
    pendingFrameRecovery = null;
  }

  function scheduleEmbeddedFrameRecovery(canRestore, restore) {
    if (!pendingFrameRecovery || frameRecoverySchedulePending) return;
    frameRecoverySchedulePending = true;
    setTimeout(() => {
      frameRecoverySchedulePending = false;
      if (pendingFrameRecovery && canRestore()) restore(pendingFrameRecovery);
    }, 0);
  }
`;
}
