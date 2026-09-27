import { NATIVE_COMPOSER_RESPONSIVE_STYLE } from './native-composer-responsive-style.mjs';

export function buildNativeComposerTransitionShieldSource() {
  return `
  const COMPOSER_TRANSITION_VERSION = '2026-09-28.responsive';
  const COMPOSER_TRANSITION_STYLE = 'data-ccc-composer-transition-style';
  if (window.__codexControlConsoleComposerTransitionVersion !== COMPOSER_TRANSITION_VERSION || !window.__codexControlConsoleComposerTransition) {
    window.__codexControlConsoleComposerTransition?.dispose?.();
    document.querySelector('style[' + COMPOSER_TRANSITION_STYLE + ']')?.remove();
    const style = document.createElement('style'); style.setAttribute(COMPOSER_TRANSITION_STYLE, '');
    style.textContent = '[data-composer-navigation-target="permissions"]{display:none!important}' + ${JSON.stringify(NATIVE_COMPOSER_RESPONSIVE_STYLE)};
    document.head.append(style);
    const controls = ['[data-codex-control-console-turn-state]','[data-ccc-held-queue-button]','[data-ccc-save-draft-todo]','[data-ccc-claim-task]','[data-codex-control-console-context-toggle]','[data-codex-control-console-native-jev-current]'];
    const retained = new Map(); let scheduled = false;
    const capture = () => { for (const selector of controls) { const node = document.querySelector(selector); if (node) retained.set(selector, node); } };
    const stabilize = () => { scheduled = false; capture(); const permission = document.querySelector('[data-composer-navigation-target="permissions"]'), host = permission?.parentElement; if (!host) return; for (const selector of controls) { const node = retained.get(selector); if (node && node.parentElement !== host) host.append(node); } window.__codexControlConsoleComposerControlOrder?.apply?.(); };
    const begin = () => { capture(); if (scheduled) return; scheduled = true; queueMicrotask(stabilize); };
    const relevantSelector = '[data-composer-navigation-target="permissions"],' + controls.join(',');
    const relevantNode = (node) => node?.nodeType === 1 && (node.matches?.(relevantSelector) || node.querySelector?.(relevantSelector));
    const observer = new MutationObserver((records) => { if (records.some((record) => [...record.addedNodes, ...record.removedNodes].some(relevantNode))) begin(); }); observer.observe(document.documentElement, { childList:true, subtree:true }); begin();
    window.__codexControlConsoleComposerTransition = { begin, stabilize, snapshot: () => ({ retained:retained.size, connected:[...retained.values()].filter((node)=>node.isConnected).length }), dispose: () => { observer.disconnect(); style.remove(); retained.clear(); } };
    window.__codexControlConsoleComposerTransitionVersion = COMPOSER_TRANSITION_VERSION;
  }`;
}
