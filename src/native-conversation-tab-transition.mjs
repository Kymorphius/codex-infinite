export function showPendingNativeConversationTab(root, key) {
  root?.querySelectorAll('[data-navigation-pending],[data-navigation-superseded]').forEach((node) => {
    node.removeAttribute('data-navigation-pending');
    node.removeAttribute('data-navigation-superseded');
  });
  const current = root?.querySelector('[aria-selected="true"]');
  const target = Array.from(root?.querySelectorAll('[data-tab-key]') || []).find((node) => node.dataset.tabKey === key);
  if (!target || target === current) return;
  current?.setAttribute('data-navigation-superseded', '');
  target.setAttribute('data-navigation-pending', '');
  target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}

export function nativeConversationTabTransitionStyle(rootSelector) {
  return rootSelector + ' .ccc-native-tab[aria-selected="true"]:not([data-navigation-superseded]),' + rootSelector + ' .ccc-native-tab[data-navigation-pending]{background:color-mix(in srgb,currentColor 12%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,currentColor 7%,transparent),0 1px 2px rgba(0,0,0,.08)}' +
    rootSelector + ' .ccc-native-tab[data-navigation-pending] .ccc-native-tab-title{opacity:.7}';
}

export function createNativeConversationTabTransition(root, onTimeout) {
  let pending = '', timer = null;
  return {
    request(key) {
      pending = key;
      showPendingNativeConversationTab(root, key);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { pending = ''; timer = null; onTimeout(); }, 4000);
    },
    isPending() { return Boolean(pending); },
    matches(key) { return pending === key; },
    clear() { pending = ''; if (timer) { clearTimeout(timer); timer = null; } },
    dispose() { this.clear(); }
  };
}

export function buildNativeConversationTabTransitionSource() {
  return `${showPendingNativeConversationTab.toString()}\n${nativeConversationTabTransitionStyle.toString()}\n${createNativeConversationTabTransition.toString()}`;
}
