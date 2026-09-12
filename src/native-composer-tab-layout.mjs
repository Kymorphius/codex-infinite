// Reserve a stable row without moving or inserting children into native React nodes.
export function createNativePageTabInset(document) {
  const attribute = 'data-ccc-native-page-tab-inset';
  const style = document.createElement('style');
  const surface = 'main[class*="_MainContentSurface_"]';
  const globalHeader = ':has(>[data-testid="app-shell-header-context-menu-surface"])';
  style.textContent = '[' + attribute + '],' + surface + '{padding-top:36px!important;box-sizing:border-box!important}';
  // The fixed app header spans the sidebar too. Moving it moves Electron's drag
  // region over the sidebar controls, regardless of DOM pointer-events:none.
  style.textContent += '[' + attribute + ']>header:not(' + globalHeader + '),' + surface + '>header:not(' + globalHeader + '){top:36px!important}';
  style.textContent += surface + '>header>[data-testid="app-shell-header-context-menu-surface"]{translate:0 36px}';
  document.head.append(style);
  let host = null;
  return {
    update(candidate) {
      const next = candidate?.matches?.('main,[role="main"]') ? candidate : null;
      if (host === next) return;
      host?.removeAttribute(attribute); host = next; host?.setAttribute(attribute, '');
    },
    dispose() { host?.removeAttribute(attribute); host = null; style.remove(); }
  };
}
export function buildInsetSource() { return createNativePageTabInset.toString(); }
