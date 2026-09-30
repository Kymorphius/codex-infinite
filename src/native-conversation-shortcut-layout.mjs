// Keep the overlay outside React ownership, but reserve its own row in layout.
export function createConversationShortcutLayout(document, window, toolbar) {
  const attribute = 'data-ccc-shortcut-space';
  const base = '--ccc-shortcut-base-margin', space = '--ccc-shortcut-height';
  const style = document.createElement('style');
  style.textContent = `[${attribute}]{margin-top:calc(var(${base},0px) + var(${space},44px))!important}`;
  document.head.append(style);
  let host = null, disposed = false, lastBox = null;
  const set = (node, key, value) => { if (node.style.getPropertyValue(key) !== value) node.style.setProperty(key, value); };
  const release = () => {
    if (!host) return;
    observer?.unobserve(host);
    host.removeAttribute(attribute); host.style.removeProperty(base); host.style.removeProperty(space);
    host = null; lastBox = null;
  };
  const isVisible = node => {
    if (node.isConnected === false || node.hidden || node.getAttribute('aria-hidden') === 'true' || node.getAttribute('data-state') === 'closed') return false;
    if (!node.getClientRects().length) return false;
    const appearance = window.getComputedStyle(node);
    return appearance.visibility !== 'hidden' && appearance.visibility !== 'collapse' && appearance.display !== 'none';
  };
  const usableBox = (box, offset = 0) => Boolean(box && box.width > 0 && box.height > 0 && box.top - offset > 0 && box.top - offset < window.innerHeight);
  const nativeHost = () => {
    const surfaces = new Map(); let retained = null;
    const candidates = [
      ...Array.from(document.querySelectorAll('[data-codex-composer="true"]'), composer => [composer.closest('[data-composer-surface-variant]'), composer]),
      ...Array.from(document.querySelectorAll('form[data-thread-find-composer="true"][data-composer-placement]'), form => [form, form])
    ];
    for (const [surface, composer] of candidates) {
      if (!surface || composer.isConnected === false || surface.isConnected === false) continue;
      if (!surfaces.has(surface)) surfaces.set(surface, []);
      surfaces.get(surface).push(composer);
    }
    for (const [surface, composers] of surfaces) {
      const box = surface.getBoundingClientRect(), inView = usableBox(box);
      const reserve = surface === host ? parseFloat(surface.style.getPropertyValue(space)) || 0 : 0;
      // Keep owned spacing when it alone pushed the current anchor out of view.
      if (!inView && !(reserve > 0 && usableBox(box, reserve))) continue;
      if (!isVisible(surface) || !composers.some(isVisible)) continue;
      if (inView) return surface;
      retained = surface;
    }
    return retained;
  };
  const update = () => {
    if (disposed) return;
    // Inside a terminal conversation the native composer is hidden; anchor to the
    // terminal composer instead, which reserves the row through its own margin.
    const terminalAnchor = window.__cccNativeTerminalView?.composer;
    const terminal = terminalAnchor?.isConnected ? terminalAnchor : null;
    const next = terminal ? null : nativeHost();
    if (next !== host) {
      release(); host = next;
      if (host) {
        set(host, base, window.getComputedStyle(host).marginTop || '0px');
        host.setAttribute(attribute, ''); observer?.observe(host);
      }
    }
    const anchor = terminal || host, box = anchor?.getBoundingClientRect();
    const dialogs = Array.from(document.querySelectorAll('dialog[open],[role="dialog"],[role="alertdialog"],[aria-modal="true"]'));
    const isModal = node => node.getAttribute('aria-modal') === 'true' || node.getAttribute('role') === 'alertdialog'
      || node.tagName === 'DIALOG' && node.matches?.(':modal');
    const modal = dialogs.some(node => !toolbar.contains?.(node) && isModal(node) && isVisible(node));
    const modelPicker = Array.from(document.querySelectorAll('[data-reasoning-slider],[data-model-picker-view-toggle],[data-composer-navigation-target="reasoning"][aria-expanded="true"],[data-composer-navigation-target="model"][aria-expanded="true"]')).some(isVisible);
    const measured = toolbar.getBoundingClientRect();
    if (!toolbar.hidden && measured.width > 0) lastBox = measured;
    const toolBox = lastBox || measured;
    const overlapsToolbar = node => {
      if (toolbar.contains?.(node) || !isVisible(node)) return false;
      const bounds = node.getBoundingClientRect();
      return bounds.left < toolBox.right && bounds.right > toolBox.left && bounds.top < toolBox.bottom && bounds.bottom > toolBox.top;
    };
    const obscured = dialogs.some(node => !isModal(node) && overlapsToolbar(node))
      || Array.from(document.querySelectorAll('[role="menu"],[role="listbox"],[data-radix-menu-content]')).some(overlapsToolbar);
    const visible = !modal && !modelPicker && !obscured && usableBox(box);
    if (toolbar.hidden === visible) toolbar.hidden = !visible;
    if (!visible) return;
    const appearance = window.getComputedStyle(anchor);
    const surface = appearance.backgroundColor;
    if (surface && surface !== 'transparent' && surface !== 'rgba(0, 0, 0, 0)') set(toolbar, '--ccc-shortcut-surface', surface);
    else toolbar.style.removeProperty('--ccc-shortcut-surface');
    if (appearance.fontFamily) set(toolbar, '--ccc-shortcut-font', appearance.fontFamily);
    const inset = box.width > 100 ? 12 : 4;
    set(toolbar, 'width', Math.max(0, Math.min(box.width - inset * 2, window.innerWidth - box.left - inset - 8)) + 'px');
    const reserve = (toolbar.getBoundingClientRect().height || 34) + 16 + 'px';
    if (terminal) set(terminal, 'margin-top', reserve); else set(host, space, reserve);
    const placed = anchor.getBoundingClientRect();
    set(toolbar, 'left', Math.max(8, Math.round(placed.left + inset)) + 'px');
    set(toolbar, 'bottom', Math.max(8, Math.round(window.innerHeight - placed.top + 8)) + 'px');
  };
  const observer = typeof window.ResizeObserver === 'function' ? new window.ResizeObserver(update) : null;
  observer?.observe(toolbar);
  return { update, dispose() { disposed = true; release(); observer?.disconnect(); style.remove(); } };
}
