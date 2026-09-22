export function createNativeClaimTaskButton(getThreadId) {
  return () => {
    const threadId = getThreadId();
    const node = document.createElement('button'); node.type = 'button'; node.textContent = threadId ? '领任务' : '指派任务'; node.title = threadId ? '从综合任务清单领取一项未指派任务到当前会话' : '把综合任务指派给已有会话';
    node.addEventListener('click', (event) => { event.preventDefault(); event.stopImmediatePropagation(); const id = getThreadId(); if (id) window.__cccProjectChecklist?.openClaimableForCurrentThread?.(id); else window.__cccProjectChecklist?.openGeneral?.(); }, true);
    return node;
  };
}

export function ensureNativeClaimTaskButton(host, before, createButton) {
  let claim = document.querySelector('[data-ccc-claim-task]');
  if (!claim) {
    claim = createButton(); claim.dataset.cccClaimTask = '';
    claim.style.cssText = 'display:inline-flex;order:2;align-items:center;height:28px;padding:0 9px;border:1px solid rgba(128,128,128,.25);border-radius:999px;background:transparent;color:currentColor;font:600 12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap';
    host.insertBefore(claim, before?.parentElement === host ? before : null);
  }
  return claim;
}

export function renderNativeClaimTaskButton(button, count, threadId = true) {
  const value = Math.max(0, Math.floor(Number(count) || 0));
  const text = (threadId ? '领任务 ' : '指派任务 ') + value;
  const title = value ? (threadId ? '从综合任务清单领取 ' + value + ' 项未指派任务到当前会话' : '把 ' + value + ' 项未指派任务指派给已有会话') : '综合任务清单当前没有未指派任务';
  if (button.textContent !== text) button.textContent = text;
  if (button.title !== title) button.title = title;
}

export function createNativeClaimTaskBridge(getThreadId) {
  let count = 0;
  const render = (button) => {
    const threadId = getThreadId();
    const text = (threadId ? '领任务 ' : '指派任务 ') + count;
    const title = count ? (threadId ? '从综合任务清单领取 ' + count + ' 项未指派任务到当前会话' : '把 ' + count + ' 项未指派任务指派给已有会话') : '综合任务清单当前没有未指派任务';
    if (button.textContent !== text) button.textContent = text;
    if (button.title !== title) button.title = title;
  };
  const ensure = (host, before) => { let button = document.querySelector('[data-ccc-claim-task]'); if (!button) { button = document.createElement('button'); button.type = 'button'; button.dataset.cccClaimTask = ''; button.addEventListener('click', (event) => { event.preventDefault(); event.stopImmediatePropagation(); const id = getThreadId(); if (id) window.__cccProjectChecklist?.openClaimableForCurrentThread?.(id); else window.__cccProjectChecklist?.openGeneral?.(); }, true); host.insertBefore(button, before?.parentElement === host ? before : null); } button.style.cssText = 'display:inline-flex;order:2;align-items:center;height:28px;padding:0 9px;border:1px solid rgba(128,128,128,.25);border-radius:999px;background:transparent;color:currentColor;font:600 12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap'; render(button); return button; };
  return { ensure, set(value) { count = Math.max(0, Math.floor(Number(value) || 0)); const button = document.querySelector('[data-ccc-claim-task]'); if (button) render(button); return count; } };
}
