export function findNativeJevModelChangeNotices(root = document) {
  return Array.from(root.querySelectorAll('span')).filter((node) => {
    if (node.hasAttribute('data-codex-control-console-jev-model-change')) return true;
    const value = Array.from(node.childNodes || []).filter((child) => child.nodeType === 3).map((child) => child.nodeValue || '').join('').trim();
    return value === '模型已从 自定义 更改为 自定义。' || value === 'Model changed from Custom to Custom.';
  });
}

export function updateNativeJevPendingRetry(items, currentTimer, retry, now = Date.now, wait = setTimeout, cancel = clearTimeout) {
  if (!items.length && currentTimer) { cancel(currentTimer); return null; }
  if (!items.length || currentTimer) return currentTimer;
  const currentTime = now();
  const nextRetryAt = Math.min(...items.map((item) => item.queuedAt + 800).filter((value) => value > currentTime));
  return Number.isFinite(nextRetryAt) ? wait(retry, Math.max(50, nextRetryAt - currentTime)) : null;
}

export function installNativeJevMutationRefresh({ install, findModelChangeNotices, hostWindow = window }) {
  const selector = '[data-content-search-turn-key],[data-above-composer-conversation-id],[data-composer-navigation-target="permissions"],button[aria-label="搜索"],button[aria-label="Search"],[data-codex-control-console-native-jev],[data-codex-control-console-native-jev-current],[data-codex-control-console-jev-turn]';
  let installFrame = null;

  function isModelChangeNotice(node) {
    if (node?.nodeType !== 1 || !node.matches?.('span')) return false;
    if (node.hasAttribute('data-codex-control-console-jev-model-change')) return true;
    const value = Array.from(node.childNodes || []).filter((child) => child.nodeType === 3).map((child) => child.nodeValue || '').join('').trim();
    return value === '模型已从 自定义 更改为 自定义。' || value === 'Model changed from Custom to Custom.';
  }

  function relevant(node) {
    if (node?.nodeType === 3) return isModelChangeNotice(node.parentElement);
    if (node?.nodeType !== 1) return false;
    return isModelChangeNotice(node) || node.matches?.(selector) || Boolean(node.querySelector?.(selector)) || findModelChangeNotices(node).length > 0;
  }

  function schedule() {
    if (installFrame !== null) return;
    installFrame = 0;
    const frame = requestAnimationFrame(() => { installFrame = null; install(); });
    if (installFrame !== null) installFrame = frame;
  }

  function receive(records) {
    if ((Array.isArray(records) ? records : []).some((record) => {
      if (record?.type === 'characterData') return relevant(record.target);
      if (record?.type !== 'childList') return false;
      return relevant(record.target) || Array.from(record.addedNodes || []).some(relevant) || Array.from(record.removedNodes || []).some(relevant);
    })) schedule();
  }

  const subscribers = hostWindow.__codexControlConsoleMutationSubscribers ||= new Set();
  subscribers.add(receive);
  return () => {
    subscribers.delete(receive);
    if (installFrame !== null) cancelAnimationFrame(installFrame);
    installFrame = null;
  };
}
