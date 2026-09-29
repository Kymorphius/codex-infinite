// Router metadata is untrusted; never forward arbitrary request fields to UI.
export function normalizeNativeRequestObservation(value = {}) {
  const efforts = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
  const result = {};
  for (const key of ['requestedReasoningEffort', 'effectiveReasoningEffort']) {
    if (efforts.includes(value[key])) result[key] = value[key];
  }
  for (const key of ['nativePreparationMs', 'nativeRequestBytes', 'nativeUploadBytes']) {
    if (Number.isSafeInteger(value[key]) && value[key] >= 0) result[key] = value[key];
  }
  return result;
}

export function renderNativeReasoningAdjustment(snapshot, threadId, doc = document) {
  const selector = '[data-ccc-native-reasoning-adjustment]';
  let badge = doc.querySelector(selector);
  const host = doc.querySelector('button[data-codex-control-console-native-jev-current]');
  const latest = (snapshot?.entries || []).filter(entry => entry.threadId === threadId)
    .reduce((best, entry) => !best || (entry.startedAt || 0) >= (best.startedAt || 0) ? entry : best, null);
  const requested = latest?.requestedReasoningEffort, effective = latest?.effectiveReasoningEffort;
  if (!snapshot?.available || !host || !requested || !effective || requested === effective) {
    badge?.remove(); return;
  }
  if (!badge) {
    badge = doc.createElement('span'); badge.setAttribute('data-ccc-native-reasoning-adjustment', '');
    badge.style.cssText = 'display:inline-flex;align-items:center;flex:none;font:12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#d7ad70;white-space:nowrap;padding:0 6px;cursor:help;';
  }
  const label = '推理 ' + requested + ' → ' + effective;
  if (badge.textContent !== label) badge.textContent = label;
  badge.title = '最近请求：模型支持范围不包含所选档位，路由实际发送 ' + effective + '；会话设置未修改。';
  badge.setAttribute('aria-label', label + '。' + badge.title);
  if (badge.parentElement !== host.parentElement) host.after(badge);
}
