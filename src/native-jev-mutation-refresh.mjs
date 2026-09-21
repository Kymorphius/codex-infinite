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
  const nativeSelector = '[data-content-search-turn-key],[data-above-composer-conversation-id],[data-composer-navigation-target="permissions"],button[aria-label="搜索"],button[aria-label="Search"]';
  const ownSelector = '[data-codex-control-console-native-jev],[data-codex-control-console-native-jev-current],[data-codex-control-console-native-jev-choice],[data-codex-control-console-jev-turn]';
  const selector = nativeSelector + ',' + ownSelector;
  let installFrame = null;
  const requestFrame = hostWindow.requestAnimationFrame?.bind(hostWindow) || requestAnimationFrame;
  const cancelFrame = hostWindow.cancelAnimationFrame?.bind(hostWindow) || cancelAnimationFrame;

  function isModelChangeNotice(node) {
    if (node?.nodeType !== 1 || !node.matches?.('span')) return false;
    if (node.hasAttribute('data-codex-control-console-jev-model-change')) return true;
    const value = Array.from(node.childNodes || []).filter((child) => child.nodeType === 3).map((child) => child.nodeValue || '').join('').trim();
    return value === '模型已从 自定义 更改为 自定义。' || value === 'Model changed from Custom to Custom.';
  }

  function owned(node) {
    const element = node?.nodeType === 3 ? node.parentElement : node;
    return Boolean(element?.matches?.(ownSelector) || element?.closest?.(ownSelector));
  }

  function directRelevant(node) {
    if (node?.nodeType === 3) return isModelChangeNotice(node.parentElement);
    if (node?.nodeType !== 1) return false;
    return isModelChangeNotice(node) || node.matches?.(selector);
  }

  function subtreeRelevant(node) {
    return directRelevant(node) || Boolean(node?.querySelector?.(selector)) || findModelChangeNotices(node).length > 0;
  }

  function schedule() {
    if (installFrame !== null) return;
    installFrame = 0;
    const frame = requestFrame(() => { installFrame = null; install(); });
    if (installFrame !== null) installFrame = frame;
  }

  function receive(records) {
    if ((Array.isArray(records) ? records : []).some((record) => {
      if (record?.type === 'characterData') return !owned(record.target) && directRelevant(record.target);
      if (record?.type !== 'childList') return false;
      if (owned(record.target)) return false;
      return directRelevant(record.target)
        || Array.from(record.addedNodes || []).some(node => !owned(node) && subtreeRelevant(node))
        || Array.from(record.removedNodes || []).some(subtreeRelevant);
    })) schedule();
  }

  const subscribers = hostWindow.__codexControlConsoleMutationSubscribers ||= new Set();
  subscribers.add(receive);
  return () => {
    subscribers.delete(receive);
    if (installFrame !== null) cancelFrame(installFrame);
    installFrame = null;
  };
}
