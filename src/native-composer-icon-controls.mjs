// Presentation-only layer: the console's composer pills become native-sized icon buttons.
// Owning modules keep their text, handlers and state; only attributes are written here.
const icon = (paths) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="black" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="${paths}"/></svg>`)}")`;

export const NATIVE_COMPOSER_ICON_CONTROLS = [
  ['save', '[data-ccc-save-draft-todo]', 'M8 2v7M5 6l3 3 3-3M2.5 10v2.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V10'],
  ['queue', '[data-ccc-held-queue-button]', 'M5 4h8M5 8h8M5 12h8M1.5 4h.01M1.5 8h.01M1.5 12h.01'],
  ['claim', '[data-ccc-claim-task]', 'M5.5 2.5h5v2h-5zM4.5 3.5h-1a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-1M5.5 9.5l2 2 3.5-4'],
  ['context', '[data-codex-control-console-context-toggle]', 'M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4'],
  ['routing', '[data-codex-control-console-native-jev-current]', 'M1 8h5l3-4.5h3.5M6 8l3 4.5h3.5M10.5 1.5l2 2-2 2M10.5 10.5l2 2-2 2'],
  ['claude', '[data-ccc-claude-preview]', 'M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3M3.4 3.4l2.1 2.1M10.5 10.5l2.1 2.1M3.4 12.6l2.1-2.1M10.5 5.5l2.1-2.1']
];
export const NATIVE_COMPOSER_ICON_CONTROLS_VERSION = '2026-09-29.1';

export const NATIVE_COMPOSER_ICON_STYLE = NATIVE_COMPOSER_ICON_CONTROLS.map(([name, , paths]) => `[data-ccc-icon="${name}"]{--ccc-icon:${icon(paths)}}`).join('')
  + '[data-ccc-icon]{display:inline-flex!important;font-size:0!important;flex:0 0 28px!important;width:28px!important;min-width:28px!important;height:28px!important;padding:0!important;gap:0!important;'
  + 'justify-content:center!important;align-items:center!important;position:relative!important;border-radius:999px!important}'
  + '[data-ccc-icon]>*{display:none!important}'
  + '[data-ccc-icon]::before{content:"";display:block;width:16px;height:16px;background:currentColor;-webkit-mask:var(--ccc-icon) center/contain no-repeat;mask:var(--ccc-icon) center/contain no-repeat}'
  + '[data-ccc-icon][data-ccc-badge]::after{content:attr(data-ccc-badge);position:absolute;top:-4px;right:-5px;min-width:15px;height:15px;padding:0 4px;box-sizing:border-box;'
  + 'border-radius:8px;background:#4f7fe0;color:#fff;font:600 9px/15px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;text-align:center;pointer-events:none}';

// Derives icon, badge and tooltip from a control's current label. Pure, so it is tested
// directly and shipped into the page.
// An owner-written title (ownTitle) is the tooltip: the owner rewrites it on its own schedule, so
// overwriting it here made the two modules trade values every sync.
export function describeComposerIconControl(label, ownAriaLabel, ownTitle = null) {
  const text = String(label || '').replace(/\s+/gu, ' ').trim();
  const count = /\s(\d{1,4})$/u.exec(text)?.[1] || '';
  return { badge: count === '0' ? '' : count, tooltip: ownTitle || ownAriaLabel || text, ariaLabel: ownAriaLabel ? null : text };
}

export function installNativeComposerIconControls(controls, style, version, describe) {
  if (window.__cccComposerIconControls?.version === version) return window.__cccComposerIconControls.apply();
  window.__cccComposerIconControls?.dispose?.();
  const sheet = document.createElement('style'); sheet.setAttribute('data-ccc-composer-icon-style', ''); sheet.textContent = style; document.head.append(sheet);
  const selector = controls.map(([, value]) => value).join(',');
  const set = (node, name, value) => { if (value === null || value === '') { if (node.hasAttribute(name)) node.removeAttribute(name); } else if (node.getAttribute(name) !== value) node.setAttribute(name, value); };
  function apply() {
    for (const [name, value] of controls) for (const node of document.querySelectorAll(value)) {
      // An aria-label we wrote is ours to refresh; one the owner wrote is kept.
      const own = node.getAttribute('aria-label'), ours = node.getAttribute('data-ccc-icon-label');
      const title = node.getAttribute('title'), ourTitle = node.getAttribute('data-ccc-icon-title'), ownerTitle = title && title !== ourTitle ? title : null;
      const { badge, tooltip, ariaLabel } = describe(node.textContent, own && own !== ours ? own : null, ownerTitle);
      set(node, 'data-ccc-icon', name); set(node, 'data-ccc-badge', badge);
      if (ownerTitle) set(node, 'data-ccc-icon-title', null); else { set(node, 'title', tooltip); set(node, 'data-ccc-icon-title', tooltip); }
      if (ariaLabel !== null) { set(node, 'aria-label', ariaLabel); set(node, 'data-ccc-icon-label', ariaLabel); }
    }
  }
  let scheduled = false;
  const observer = new MutationObserver((records) => {
    if (scheduled || !records.some((record) => (record.target.nodeType === 1 ? record.target : record.target.parentElement)?.closest?.(selector)
      || [...record.addedNodes].some((node) => node.nodeType === 1 && (node.matches?.(selector) || node.querySelector?.(selector))))) return;
    scheduled = true; queueMicrotask(() => { scheduled = false; apply(); });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  apply();
  window.__cccComposerIconControls = { version, apply, dispose() {
    observer.disconnect(); sheet.remove();
    for (const node of document.querySelectorAll('[data-ccc-icon]')) {
      node.removeAttribute('data-ccc-icon'); node.removeAttribute('data-ccc-badge');
      if (node.getAttribute('title') === node.getAttribute('data-ccc-icon-title')) node.removeAttribute('title');
      node.removeAttribute('data-ccc-icon-title');
      if (node.getAttribute('aria-label') === node.getAttribute('data-ccc-icon-label')) node.removeAttribute('aria-label');
      node.removeAttribute('data-ccc-icon-label');
    }
  } };
}

export function buildNativeComposerIconControlsSource() {
  return `(${installNativeComposerIconControls.toString()})(${JSON.stringify(NATIVE_COMPOSER_ICON_CONTROLS)}, ${JSON.stringify(NATIVE_COMPOSER_ICON_STYLE)}, ${JSON.stringify(NATIVE_COMPOSER_ICON_CONTROLS_VERSION)}, ${describeComposerIconControl.toString()})`;
}
