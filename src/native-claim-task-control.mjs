export function createNativeClaimTaskButton(getThreadId) {
  return () => {
    const node = document.createElement('button'); node.type = 'button'; node.textContent = '领取任务'; node.title = '从综合任务清单领取一项未指派任务到当前会话';
    node.addEventListener('click', (event) => { event.preventDefault(); event.stopImmediatePropagation(); const id = getThreadId(); if (id) window.__cccProjectChecklist?.openClaimableForCurrentThread?.(id); else window.__cccProjectChecklist?.openGeneral?.(); }, true);
    return node;
  };
}

export function ensureNativeClaimTaskButton(host, before, createButton) {
  let claim = document.querySelector('[data-ccc-claim-task]');
  if (!claim) {
    claim = createButton(); claim.dataset.cccClaimTask = '';
    claim.style.cssText = 'display:inline-flex;align-items:center;height:28px;padding:0 9px;border:1px solid rgba(128,128,128,.25);border-radius:999px;background:transparent;color:currentColor;font:600 12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap';
    host.insertBefore(claim, before?.parentElement === host ? before : null);
  }
  return claim;
}

export function renderNativeClaimTaskButton(button, count) {
  const value = Math.max(0, Math.floor(Number(count) || 0));
  button.textContent = '领取任务 ' + value;
  button.title = value ? '从综合任务清单领取 ' + value + ' 项未指派任务到当前会话' : '综合任务清单当前没有未指派任务';
}

export function createNativeClaimTaskBridge(getThreadId) {
  let count = 0;
  const render = (button) => { button.textContent = '领取任务 ' + count; button.title = count ? (getThreadId() ? '从综合任务清单领取 ' + count + ' 项未指派任务到当前会话' : '有 ' + count + ' 项未指派任务；新建聊天后即可领取') : '综合任务清单当前没有未指派任务'; };
  const ensure = (host, before) => { let button = document.querySelector('[data-ccc-claim-task]'); if (!button) { button = document.createElement('button'); button.type = 'button'; button.dataset.cccClaimTask = ''; button.style.cssText = 'display:inline-flex;align-items:center;height:28px;padding:0 9px;border:1px solid rgba(128,128,128,.25);border-radius:999px;background:transparent;color:currentColor;font:600 12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap'; button.addEventListener('click', (event) => { event.preventDefault(); event.stopImmediatePropagation(); const id = getThreadId(); if (id) window.__cccProjectChecklist?.openClaimableForCurrentThread?.(id); else window.__cccProjectChecklist?.openGeneral?.(); }, true); host.insertBefore(button, before?.parentElement === host ? before : null); } render(button); return button; };
  return { ensure, set(value) { count = Math.max(0, Math.floor(Number(value) || 0)); const button = document.querySelector('[data-ccc-claim-task]'); if (button) render(button); return count; } };
}
