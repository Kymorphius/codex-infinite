export function buildNativeJevComposerControlSource() {
  return `
  function choiceForCurrentThread(threadId) {
    const receipt = [...policy.receipts].reverse().find((item) => item?.threadId === threadId && formatTurnChoice(item));
    if (receipt) return { value: receipt, title: '当前会话最近一轮的 Jev 路由结果；下一轮会重新自动选择' };
    const fallback = policy.mappings[policy.fallbackTier];
    return fallback ? { value: fallback, title: '下一轮会由 Jev 自动选择；当前显示的是“' + policy.fallbackTier + '”兜底映射' } : null;
  }

  function renderNativeModelControl(active) {
    const control = document.querySelector('[data-composer-navigation-target="reasoning"],[data-composer-navigation-target="model"]');
    if (!control) return;
    if (!active) { window.__codexControlConsoleRestoreJevNativeModelControl?.(); return; }
    if (!control.hasAttribute('data-codex-control-console-jev-native-model-style')) control.setAttribute('data-codex-control-console-jev-native-model-style', control.getAttribute('style') || '');
    if (!control.hasAttribute('data-codex-control-console-jev-native-model-title')) control.setAttribute('data-codex-control-console-jev-native-model-title', control.getAttribute('title') || '');
    if (!control.hasAttribute('data-codex-control-console-jev-native-model-tabindex')) control.setAttribute('data-codex-control-console-jev-native-model-tabindex', control.getAttribute('tabindex') || '');
    control.setAttribute('aria-disabled', 'true'); control.setAttribute('data-codex-control-console-jev-native-model-disabled', ''); control.tabIndex = -1;
    control.title = 'Jev 已接管模型与推理强度；关闭 Jev 路由后可恢复原生选择';
    control.style.setProperty('opacity', '.42', 'important'); control.style.setProperty('filter', 'grayscale(1)', 'important'); control.style.setProperty('pointer-events', 'none', 'important'); control.style.setProperty('cursor', 'not-allowed', 'important');
  }

  window.__codexControlConsoleRestoreJevNativeModelControl = () => {
    const control = document.querySelector('[data-codex-control-console-jev-native-model-disabled]'); if (!control) return;
    const style = control.getAttribute('data-codex-control-console-jev-native-model-style'); if (style) control.setAttribute('style', style); else control.removeAttribute('style');
    const title = control.getAttribute('data-codex-control-console-jev-native-model-title'); if (title) control.title = title; else control.removeAttribute('title');
    const tabindex = control.getAttribute('data-codex-control-console-jev-native-model-tabindex'); if (tabindex) control.setAttribute('tabindex', tabindex); else control.removeAttribute('tabindex');
    control.removeAttribute('aria-disabled'); control.removeAttribute('data-codex-control-console-jev-native-model-disabled'); control.removeAttribute('data-codex-control-console-jev-native-model-style'); control.removeAttribute('data-codex-control-console-jev-native-model-title'); control.removeAttribute('data-codex-control-console-jev-native-model-tabindex');
  };

  function renderCurrentChoice(node, threadId, active) {
    const choice = active ? choiceForCurrentThread(threadId) : null;
    if (!choice?.value?.model || !choice?.value?.effort) { node?.remove(); return null; }
    const chip = node || document.createElement('span'); chip.setAttribute('data-codex-control-console-native-jev-choice', '');
    const model = String(choice.value.model).replace(/^gpt-/i, 'GPT-').replace(/-(luna|terra|sol|astra)$/i, (_, name) => ' ' + name[0].toUpperCase() + name.slice(1));
    chip.textContent = model + '（' + choice.value.effort + '）'; chip.title = choice.title; chip.setAttribute('aria-label', 'Jev 当前模型和推理强度：' + chip.textContent);
    chip.style.cssText = 'display:inline-flex;align-items:center;height:28px;padding:0 7px;color:#a9d9b9;font:600 11px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap;opacity:.9;-webkit-app-region:no-drag;app-region:no-drag;';
    return chip;
  }
`;
}
