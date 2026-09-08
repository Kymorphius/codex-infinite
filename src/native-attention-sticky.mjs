export const NATIVE_ATTENTION_HEADINGS = Object.freeze(["现在", "等待", "本周", "待整理"]);

export function buildNativeAttentionStickyInjectionScript() {
  return `(() => {
  const VERSION = '2026-09-05.1';
  const MARKER = 'data-codex-control-console-attention-sticky';
  const FOCUS_MARKER = 'data-codex-control-console-window-focus';
  const STYLE_SELECTOR = 'style[data-codex-control-console-attention-sticky-style]';
  const ALLOWED = new Set(${JSON.stringify(NATIVE_ATTENTION_HEADINGS)});
  if (window.__codexControlConsoleAttentionStickyVersion === VERSION && window.__codexControlConsoleAttentionStickyObserver) return;
  window.__codexControlConsoleAttentionStickyObserver?.disconnect?.();
  window.removeEventListener('focus', window.__codexControlConsoleAttentionStickyFocusListener);
  window.removeEventListener('blur', window.__codexControlConsoleAttentionStickyFocusListener);
  delete window.__codexControlConsoleAttentionStickyFocusListener;
  document.documentElement.removeAttribute(FOCUS_MARKER);
  document.querySelectorAll('[' + MARKER + ']').forEach((node) => node.removeAttribute(MARKER));
  document.querySelectorAll(STYLE_SELECTOR).forEach((node) => node.remove());
  window.__codexControlConsoleAttentionStickyVersion = VERSION;
  let pending = false;

  const style = document.createElement('style');
  style.setAttribute('data-codex-control-console-attention-sticky-style', '');
  style.textContent = '[' + MARKER + '] {'
    + 'position:sticky !important;'
    + 'top:8px !important;'
    + 'z-index:24 !important;'
    + '}';
  (document.head || document.documentElement).append(style);

  function apply() {
    const retained = new Set();
    for (const section of document.querySelectorAll('section')) {
      const toggle = section.querySelector('[data-app-action-sidebar-section-toggle]');
      const title = (toggle?.textContent || '').trim();
      if (!ALLOWED.has(title)) continue;
      const heading = toggle.closest('[class*="nav-section-title"]');
      if (!heading || !section.contains(heading)) continue;
      heading.setAttribute(MARKER, title);
      retained.add(heading);
    }
    document.querySelectorAll('[' + MARKER + ']').forEach((node) => {
      if (!retained.has(node)) node.removeAttribute(MARKER);
    });
  }

  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; apply(); });
  }

  window.__codexControlConsoleAttentionStickyObserver = new MutationObserver(schedule);
  window.__codexControlConsoleAttentionStickyObserver.observe(document.documentElement, { childList: true, subtree: true });
  apply();
})()`;
}
