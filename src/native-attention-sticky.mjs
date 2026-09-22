export function buildNativeAttentionStickyInjectionScript() {
  return `(() => {
  const VERSION = '2026-09-22.retired1';
  const MARKER = 'data-codex-control-console-attention-sticky';
  const FOCUS_MARKER = 'data-codex-control-console-window-focus';
  const STYLE_SELECTOR = 'style[data-codex-control-console-attention-sticky-style]';
  window.__codexControlConsoleAttentionStickyObserver?.disconnect?.();
  window.removeEventListener('focus', window.__codexControlConsoleAttentionStickyFocusListener);
  window.removeEventListener('blur', window.__codexControlConsoleAttentionStickyFocusListener);
  delete window.__codexControlConsoleAttentionStickyFocusListener;
  document.documentElement.removeAttribute(FOCUS_MARKER);
  document.querySelectorAll('[' + MARKER + ']').forEach((node) => node.removeAttribute(MARKER));
  document.querySelectorAll(STYLE_SELECTOR).forEach((node) => node.remove());
  window.__codexControlConsoleAttentionStickyVersion = VERSION;
  window.__codexControlConsoleAttentionStickyObserver = null;
})()`;
}
