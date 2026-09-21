export function buildNativeJevButtonRenderSource() {
  return `
  function renderGlobalButton(button) {
    const active = policy.enabled;
    const signature = JSON.stringify([active, togglePending]);
    if (button.getAttribute('data-codex-control-console-jev-render-signature') === signature) return;
    button.dataset.enabled = String(active);
    button.setAttribute('aria-pressed', String(active));
    button.setAttribute('aria-label', active ? 'Jev 自动分流已开启' : 'Jev 自动分流已关闭');
    button.disabled = togglePending;
    button.textContent = 'Jev';
    button.title = togglePending ? '正在统一所有会话的自动分流设置…' : active ? '统一开启：所有未单独设置的会话自动分流；点击关闭并清除会话覆盖' : '统一关闭：所有未单独设置的会话不自动分流；点击开启并清除会话覆盖';
    button.style.cssText = 'display:inline-flex;position:relative;z-index:1;align-items:center;height:24px;padding:0 8px;border:1px solid ' + (active ? 'rgba(106,190,138,.52)' : 'rgba(128,128,128,.24)') + ';border-radius:999px;background:' + (active ? 'rgba(75,166,110,.15)' : 'transparent') + ';color:' + (active ? '#62bd84' : 'currentColor') + ';font:600 11px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap;cursor:' + (togglePending ? 'wait' : 'pointer') + ';opacity:' + (togglePending ? '.58' : '.88') + ';pointer-events:auto!important;-webkit-app-region:no-drag!important;app-region:no-drag!important;';
    button.setAttribute('data-codex-control-console-jev-render-signature', signature);
  }

  function renderCurrentButton(button) {
    const threadId = currentThreadId();
    const active = effectiveEnabled(threadId);
    const overridden = Boolean(threadId && Object.prototype.hasOwnProperty.call(policy.threadOverrides, threadId));
    const signature = JSON.stringify([threadId || '', active, overridden, togglePending, submissionPending, policy.transportMode]);
    if (button.getAttribute('data-codex-control-console-jev-render-signature') === signature) return;
    button.dataset.enabled = String(active); button.dataset.threadId = threadId || ''; button.dataset.override = String(overridden);
    button.setAttribute('aria-pressed', String(active)); button.setAttribute('aria-label', threadId ? (active ? '当前会话 Jev 自动分流已开启' : '当前会话 Jev 自动分流已关闭') : (active ? '新建聊天的全局 Jev 自动分流已开启' : '新建聊天的全局 Jev 自动分流已关闭')); button.disabled = togglePending || submissionPending;
    button.textContent = submissionPending ? '判断中…' : policy.transportMode === 'native' ? '直连' : '路由';
    button.title = !threadId ? (active ? '新建聊天继承全局 Jev 路由；点击关闭全局路由' : '新建聊天继承全局设置；点击开启全局 Jev 路由') : submissionPending ? 'Jev 正在为这一轮选择模型与推理强度' : togglePending ? '正在保存当前会话设置…' : (overridden ? '当前会话单独' : '继承全局') + (active ? '开启；点击只关闭当前会话' : '关闭；点击只开启当前会话');
    button.style.cssText = 'display:inline-flex;position:relative;z-index:1;order:4;flex:0 0 58px;justify-content:center;align-items:center;height:28px;padding:0 9px;border:1px solid ' + (active ? 'rgba(106,190,138,.52)' : 'rgba(128,128,128,.25)') + ';border-radius:999px;background:' + (active ? 'rgba(75,166,110,.15)' : 'transparent') + ';color:' + (active ? '#62bd84' : 'currentColor') + ';font:600 12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap;cursor:' + (togglePending ? 'wait' : 'pointer') + ';opacity:' + (togglePending ? '.58' : '1') + ';pointer-events:auto!important;-webkit-app-region:no-drag!important;app-region:no-drag!important;';
    button.setAttribute('data-codex-control-console-jev-render-signature', signature);
  }
`;
}
