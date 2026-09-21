export function buildNativeComposerTransitionShieldSource() {
  return `
  const COMPOSER_TRANSITION_VERSION = '2026-09-22.1';
  const COMPOSER_TRANSITION_ATTRIBUTE = 'data-ccc-composer-controls-transition';
  const COMPOSER_TRANSITION_STYLE = 'data-ccc-composer-transition-style';
  if (window.__codexControlConsoleComposerTransitionVersion !== COMPOSER_TRANSITION_VERSION || !window.__codexControlConsoleComposerTransition) {
    window.__codexControlConsoleComposerTransition?.dispose?.();
    document.querySelector('style[' + COMPOSER_TRANSITION_STYLE + ']')?.remove();
    const style = document.createElement('style'); style.setAttribute(COMPOSER_TRANSITION_STYLE, '');
    style.textContent = '[data-composer-navigation-target="permissions"]{display:none!important}' +
      'html[' + COMPOSER_TRANSITION_ATTRIBUTE + '] [data-ccc-held-queue-button],html[' + COMPOSER_TRANSITION_ATTRIBUTE + '] [data-ccc-save-draft-todo],html[' + COMPOSER_TRANSITION_ATTRIBUTE + '] [data-ccc-claim-task],html[' + COMPOSER_TRANSITION_ATTRIBUTE + '] [data-codex-control-console-context-toggle],html[' + COMPOSER_TRANSITION_ATTRIBUTE + '] [data-codex-control-console-native-jev-current],html[' + COMPOSER_TRANSITION_ATTRIBUTE + '] [data-codex-control-console-turn-state]{visibility:hidden!important}';
    document.head.append(style);
    let timer = null;
    const begin = () => { document.documentElement.setAttribute(COMPOSER_TRANSITION_ATTRIBUTE, ''); clearTimeout(timer); timer = setTimeout(() => document.documentElement.removeAttribute(COMPOSER_TRANSITION_ATTRIBUTE), 180); };
    window.__codexControlConsoleComposerTransition = { begin, dispose: () => { clearTimeout(timer); document.documentElement.removeAttribute(COMPOSER_TRANSITION_ATTRIBUTE); style.remove(); } };
    window.__codexControlConsoleComposerTransitionVersion = COMPOSER_TRANSITION_VERSION;
  }`;
}
