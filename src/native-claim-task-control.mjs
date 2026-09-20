export function createNativeClaimTaskButton(getThreadId) {
  return () => {
    const node = document.createElement('button'); node.type = 'button'; node.textContent = '领取任务'; node.title = '从综合任务清单领取一项未指派任务到当前会话';
    node.addEventListener('click', (event) => { event.preventDefault(); event.stopImmediatePropagation(); const id = getThreadId(); if (id) window.__cccProjectChecklist?.openClaimableForCurrentThread?.(id); }, true);
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
