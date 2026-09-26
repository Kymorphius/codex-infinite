export function buildNativeJevButtonRenderSource() {
  return `
  function renderGlobalButton(button) {
    const active = policy.enabled;
    const signature = JSON.stringify([active, togglePending, policy.transportMode]);
    if (button.getAttribute('data-codex-control-console-jev-render-signature') === signature) return;
    button.dataset.enabled = String(active);
    button.setAttribute('aria-pressed', String(active));
    button.setAttribute('aria-label', '全局 Jev 自动分流已' + (active ? '开启' : '关闭') + '，' + (policy.transportMode === 'native' ? '直连模式' : '路由模式'));
    button.disabled = togglePending;
    button.title = (policy.transportMode === 'native' ? '直连模式；' : '路由模式；') + (togglePending ? '正在统一所有会话的自动分流设置…' : active ? '统一开启：所有未单独设置的会话自动分流；点击关闭并清除会话覆盖' : '统一关闭：所有未单独设置的会话不自动分流；点击开启并清除会话覆盖');
    button.style.cssText = 'display:inline-flex;position:relative;z-index:1;flex:0 0 28px;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:1px solid ' + (active ? 'rgba(106,190,138,.52)' : 'rgba(128,128,128,.24)') + ';border-radius:8px;background:' + (active ? 'rgba(75,166,110,.15)' : 'transparent') + ';color:' + (active ? '#62bd84' : 'currentColor') + ';cursor:' + (togglePending ? 'wait' : 'pointer') + ';opacity:' + (togglePending ? '.58' : '.88') + ';pointer-events:auto!important;-webkit-app-region:no-drag!important;app-region:no-drag!important;';
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('width', '17'); icon.setAttribute('height', '17');
    icon.setAttribute('fill', 'none'); icon.setAttribute('stroke', 'currentColor'); icon.setAttribute('stroke-width', '1.8');
    icon.setAttribute('stroke-linecap', 'round'); icon.setAttribute('stroke-linejoin', 'round');
    icon.setAttribute('aria-hidden', 'true'); icon.setAttribute('focusable', 'false');
    for (const [cx, cy] of [[5, 4], [19, 6], [19, 18]]) {
      const node = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      node.setAttribute('cx', String(cx)); node.setAttribute('cy', String(cy)); node.setAttribute('r', '2'); icon.append(node);
    }
    const branch = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    branch.setAttribute('d', 'M5 6v8a4 4 0 0 0 4 4h8M5 12h8a6 6 0 0 0 6-4'); icon.append(branch);
    button.replaceChildren(icon);
    button.setAttribute('data-codex-control-console-jev-render-signature', signature);
  }

  function renderCurrentButton(button) {
    const threadId = currentThreadId();
    const active = effectiveEnabled(threadId);
    const routeActive = active && (policy.transportMode !== 'native' || Boolean(threadId));
    const overridden = Boolean(threadId && Object.prototype.hasOwnProperty.call(policy.threadOverrides, threadId));
    const signature = JSON.stringify([threadId || '', active, overridden, togglePending, submissionPending, policy.transportMode]);
    if (button.getAttribute('data-codex-control-console-jev-render-signature') === signature) return;
    button.dataset.enabled = String(routeActive); button.dataset.threadId = threadId || ''; button.dataset.override = String(overridden);
    button.setAttribute('aria-pressed', String(routeActive)); button.setAttribute('aria-label', threadId ? (active ? '当前会话 Jev 自动分流已开启' : '当前会话 Jev 自动分流已关闭') : policy.transportMode === 'native' ? '新建聊天首轮暂用原生模型，建立会话后 Jev 直连生效' : (active ? '新建聊天的全局 Jev 自动分流已开启' : '新建聊天的全局 Jev 自动分流已关闭')); button.disabled = togglePending || submissionPending;
    button.textContent = submissionPending ? '判断中…' : policy.transportMode === 'native' ? '直连' : '路由';
    button.title = !threadId ? (policy.transportMode === 'native' ? '新建聊天首轮使用原生模型；会话建立后 Jev 直连生效。切换路由模式可从首轮分流' : active ? '新建聊天继承全局 Jev 路由；点击关闭全局路由' : '新建聊天继承全局设置；点击开启全局 Jev 路由') : submissionPending ? 'Jev 正在为这一轮选择模型与推理强度' : togglePending ? '正在保存当前会话设置…' : (overridden ? '当前会话单独' : '继承全局') + (active ? '开启；点击只关闭当前会话' : '关闭；点击只开启当前会话');
    button.style.cssText = 'display:inline-flex;position:relative;z-index:1;order:4;flex:0 0 48px;justify-content:center;align-items:center;height:28px;padding:0 6px;border:1px solid ' + (routeActive ? 'rgba(106,190,138,.52)' : 'rgba(128,128,128,.25)') + ';border-radius:999px;background:' + (routeActive ? 'rgba(75,166,110,.15)' : 'transparent') + ';color:' + (routeActive ? '#62bd84' : 'currentColor') + ';font:600 12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap;cursor:' + (togglePending ? 'wait' : 'pointer') + ';opacity:' + (togglePending ? '.58' : '1') + ';pointer-events:auto!important;-webkit-app-region:no-drag!important;app-region:no-drag!important;';
    button.setAttribute('data-codex-control-console-jev-render-signature', signature);
  }
`;
}
