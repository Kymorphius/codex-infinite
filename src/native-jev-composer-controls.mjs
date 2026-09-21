export function buildNativeJevComposerControlSource() {
  return `
  function choiceForCurrentThread(threadId) {
    const receipt = [...policy.receipts].reverse().find((item) => item?.threadId === threadId && formatTurnChoice(item));
    if (receipt) return { value: receipt, title: '当前会话最近一轮的 Jev 路由结果；下一轮会重新自动选择' };
    const fallback = policy.mappings[policy.fallbackTier];
    return fallback ? { value: fallback, title: '下一轮会由 Jev 自动选择；当前显示的是“' + policy.fallbackTier + '”兜底映射' } : null;
  }

  function renderNativeModelControl(active, threadId) {
    const control = document.querySelector('[data-composer-navigation-target="reasoning"],[data-composer-navigation-target="model"]');
    if (!control) return;
    if (!active) { window.__codexControlConsoleRestoreJevNativeModelControl?.(); return; }
    const choice = choiceForCurrentThread(threadId);
    if (!control.hasAttribute('data-codex-control-console-jev-native-model-style')) control.setAttribute('data-codex-control-console-jev-native-model-style', control.getAttribute('style') || '');
    if (!control.hasAttribute('data-codex-control-console-jev-native-model-title')) control.setAttribute('data-codex-control-console-jev-native-model-title', control.getAttribute('title') || '');
    if (!control.hasAttribute('data-codex-control-console-jev-native-model-tabindex')) control.setAttribute('data-codex-control-console-jev-native-model-tabindex', control.getAttribute('tabindex') || '');
    if (!control.hasAttribute('data-codex-control-console-jev-native-model-label')) control.setAttribute('data-codex-control-console-jev-native-model-label', control.getAttribute('aria-label') || '');
    for (const child of Array.from(control.children)) {
      if (child.tagName === 'svg' || child.hasAttribute('data-codex-control-console-jev-native-model-effective')) continue;
      if (!child.hasAttribute('data-codex-control-console-jev-native-child-visibility')) child.setAttribute('data-codex-control-console-jev-native-child-visibility', child.style.visibility || '');
      child.style.visibility = 'hidden';
    }
    const arrow = Array.from(control.children).find((child) => child.tagName === 'svg');
    if (arrow && !arrow.hasAttribute('data-codex-control-console-jev-native-arrow-style')) arrow.setAttribute('data-codex-control-console-jev-native-arrow-style', arrow.getAttribute('style') || '');
    if (arrow) { arrow.style.setProperty('position', 'absolute', 'important'); arrow.style.setProperty('right', '8px', 'important'); arrow.style.setProperty('visibility', 'visible', 'important'); arrow.style.setProperty('color', '#62bd84', 'important'); }
    let effective = control.querySelector('[data-codex-control-console-jev-native-model-effective]');
    if (!effective) { effective = document.createElement('span'); effective.setAttribute('data-codex-control-console-jev-native-model-effective', ''); control.append(effective); }
    const model = String(choice?.value?.model || '').replace(/^gpt-/i, 'GPT-').replace(/-(luna|terra|sol|astra)$/i, (_, name) => ' ' + name[0].toUpperCase() + name.slice(1));
    const effortLabels = { none: '无', minimal: '极低', low: '轻度', medium: '中', high: '高', xhigh: '极高', max: '最高', ultra: 'Ultra' };
    const effort = effortLabels[choice?.value?.effort] || choice?.value?.effort;
    const effectiveText = model && effort ? model + ' ' + effort : 'Jev 自动选择';
    const renderSignature = JSON.stringify([threadId || '', effectiveText, choice?.title || '']);
    if (control.getAttribute('data-codex-control-console-jev-native-render-signature') === renderSignature) return;
    effective.textContent = effectiveText;
    effective.style.cssText = 'position:absolute;inset:4px 28px 4px 8px;display:flex;align-items:center;justify-content:center;padding:0;visibility:visible;color:#62bd84;font:inherit;white-space:nowrap;pointer-events:none;';
    control.setAttribute('aria-disabled', 'true'); control.setAttribute('data-codex-control-console-jev-native-model-disabled', ''); control.tabIndex = -1;
    control.setAttribute('aria-label', 'Jev 当前模型和推理强度：' + effective.textContent);
    control.title = (choice?.title ? choice.title + '；' : '') + 'Jev 已接管模型与推理强度；关闭 Jev 路由后可恢复原生选择';
    control.style.setProperty('position', 'relative', 'important'); control.style.setProperty('min-width', '145px', 'important'); control.style.setProperty('opacity', '1', 'important'); control.style.setProperty('filter', 'none', 'important'); control.style.setProperty('color', '#62bd84', 'important'); control.style.setProperty('pointer-events', 'none', 'important'); control.style.setProperty('cursor', 'not-allowed', 'important');
    control.setAttribute('data-codex-control-console-jev-native-render-signature', renderSignature);
  }

  window.__codexControlConsoleRestoreJevNativeModelControl = () => {
    const control = document.querySelector('[data-codex-control-console-jev-native-model-disabled]'); if (!control) return;
    const style = control.getAttribute('data-codex-control-console-jev-native-model-style'); if (style) control.setAttribute('style', style); else control.removeAttribute('style');
    const title = control.getAttribute('data-codex-control-console-jev-native-model-title'); if (title) control.title = title; else control.removeAttribute('title');
    const tabindex = control.getAttribute('data-codex-control-console-jev-native-model-tabindex'); if (tabindex) control.setAttribute('tabindex', tabindex); else control.removeAttribute('tabindex');
    const label = control.getAttribute('data-codex-control-console-jev-native-model-label'); if (label) control.setAttribute('aria-label', label); else control.removeAttribute('aria-label');
    control.querySelector('[data-codex-control-console-jev-native-model-effective]')?.remove();
    for (const child of Array.from(control.children)) { if (!child.hasAttribute('data-codex-control-console-jev-native-child-visibility')) continue; child.style.visibility = child.getAttribute('data-codex-control-console-jev-native-child-visibility') || ''; child.removeAttribute('data-codex-control-console-jev-native-child-visibility'); }
    const arrow = Array.from(control.children).find((child) => child.tagName === 'svg'), arrowStyle = arrow?.getAttribute('data-codex-control-console-jev-native-arrow-style'); if (arrowStyle !== undefined) { if (arrowStyle) arrow.setAttribute('style', arrowStyle); else arrow.removeAttribute('style'); arrow.removeAttribute('data-codex-control-console-jev-native-arrow-style'); }
    control.removeAttribute('aria-disabled'); control.removeAttribute('data-codex-control-console-jev-native-model-disabled'); control.removeAttribute('data-codex-control-console-jev-native-model-style'); control.removeAttribute('data-codex-control-console-jev-native-model-title'); control.removeAttribute('data-codex-control-console-jev-native-model-tabindex'); control.removeAttribute('data-codex-control-console-jev-native-model-label'); control.removeAttribute('data-codex-control-console-jev-native-render-signature');
  };

  function renderCurrentChoice(node) { node?.remove(); return null; }
`;
}
