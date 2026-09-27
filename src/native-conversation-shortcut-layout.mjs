// Keep the overlay outside React ownership, but reserve its own row in layout.
export function createConversationShortcutLayout(document, window, toolbar) {
  const attribute = 'data-ccc-shortcut-space';
  const base = '--ccc-shortcut-base-margin', space = '--ccc-shortcut-height';
  const style = document.createElement('style');
  style.textContent = `[${attribute}]{margin-top:calc(var(${base},0px) + var(${space},44px))!important}`;
  document.head.append(style);
  let host = null, disposed = false;
  const set = (node, key, value) => { if (node.style.getPropertyValue(key) !== value) node.style.setProperty(key, value); };
  const release = () => {
    if (!host) return;
    observer?.unobserve(host);
    host.removeAttribute(attribute); host.style.removeProperty(base); host.style.removeProperty(space);
    host = null;
  };
  const update = () => {
    if (disposed) return;
    const next = document.querySelector('[data-codex-composer="true"][contenteditable="true"]')?.closest('[data-composer-surface-variant]') || null;
    if (next !== host) {
      release(); host = next;
      if (host) {
        set(host, base, window.getComputedStyle(host).marginTop || '0px');
        host.setAttribute(attribute, ''); observer?.observe(host);
      }
    }
    const box = host?.getBoundingClientRect();
    const modal = Array.from(document.querySelectorAll('dialog[open],[role="dialog"],[role="alertdialog"],[aria-modal="true"]')).some(node => {
      if (node.hidden || node.getAttribute('aria-hidden') === 'true' || node.getAttribute('data-state') === 'closed') return false;
      if (!node.getClientRects().length) return false;
      const appearance = window.getComputedStyle(node);
      return appearance.visibility !== 'hidden' && appearance.visibility !== 'collapse' && appearance.display !== 'none';
    });
    const visible = !modal && Boolean(box && box.width > 0 && box.height > 0 && box.top > 0 && box.top < window.innerHeight);
    if (toolbar.hidden === visible) toolbar.hidden = !visible;
    if (!visible) return;
    set(toolbar, 'max-width', Math.max(0, Math.min(box.width, window.innerWidth - box.left - 8)) + 'px');
    set(host, space, (toolbar.getBoundingClientRect().height || 34) + 16 + 'px');
    const placed = host.getBoundingClientRect();
    set(toolbar, 'left', Math.max(8, Math.round(placed.left)) + 'px');
    set(toolbar, 'bottom', Math.max(8, Math.round(window.innerHeight - placed.top + 8)) + 'px');
  };
  const observer = typeof window.ResizeObserver === 'function' ? new window.ResizeObserver(update) : null;
  observer?.observe(toolbar);
  return { update, dispose() { disposed = true; release(); observer?.disconnect(); style.remove(); } };
}
