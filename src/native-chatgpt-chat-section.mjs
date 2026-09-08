export function classifyNativeChatgptRecentTarget(target) {
  if (target?.source === "codex" || target?.conversation?.conversation_origin === "tpp") return "cloud-work";
  if (target?.source === "chatgpt" && target?.projectId) return "project-chat";
  return "ordinary-chat";
}

export function nativeChatgptConversationTrigger(row) {
  if (!row) return null;
  if (row.matches?.("a,button,[role=\"button\"]")) return row;
  return row.querySelector?.(":scope > a,:scope > button,:scope > [role=\"button\"]") || null;
}

export function buildNativeChatgptChatSectionInjectionScript() {
  const conversationTriggerSource = nativeChatgptConversationTrigger.toString();
  return `(() => {
  const VERSION = '2026-09-05.1';
  const SECTION_SELECTOR = 'section[data-app-action-sidebar-section-heading="Recents"]';
  const CLOUD_SECTION_SELECTOR = 'section[data-app-action-sidebar-section-heading="云工作"]';
  const CLOUD_CACHE_KEY = 'codex-control-console.cloud-work.v1';
  const TITLE_MARKER = 'data-codex-control-console-chat-title';
  const LEGACY_HIDDEN_MARKER = 'data-codex-control-console-non-chat-display';
  const ORDER_MARKER = 'data-codex-control-console-section-order';
  const LEGACY_CHAT_ORDER_MARKER = 'data-codex-control-console-chat-order';
  const LISTITEM_DISPLAY_MARKER = 'data-codex-control-console-listitem-display';
  const LEGACY_CLOUD_DIVIDER = 'data-codex-control-console-cloud-work-divider';
  const CLOUD_PROXY_LIST = 'data-codex-control-console-cloud-work-list';
  const CLOUD_PROXY_ROW = 'data-codex-control-console-cloud-work-row';
  const CHAT_PROXY_LIST = 'data-codex-control-console-ordinary-chat-list';
  const CHAT_PROXY_ROW = 'data-codex-control-console-ordinary-chat-row';
  const SOURCE_BOOTSTRAP_MARKER = 'data-codex-control-console-chat-source-bootstrapped';
  const PLACEHOLDER_DISPLAY_MARKER = 'data-codex-control-console-placeholder-display';
  const LOADING_ITEM_STYLE_MARKER = 'data-codex-control-console-loading-item-style';
  const LOADING_WRAP_STYLE_MARKER = 'data-codex-control-console-loading-wrap-style';
  const ROW_CLASSIFICATION_MARKER = 'data-codex-control-console-chat-classification';
  const CLASSIFICATION_STYLE_MARKER = 'data-codex-control-console-chat-classification-style';
  const SECTION_ORDER = new Map([
    ['Pinned', 1], ['置顶', 1], ['已置顶', 1], ['现在', 10], ['等待', 20], ['本周', 30], ['Projects', 40],
    ['待整理', 50], ['临时', 60], ['云工作', 70], ['项目（聊天）', 75], ['Recents', 80]
  ]);
  const classifyRecentTarget = ${classifyNativeChatgptRecentTarget.toString()};
  const conversationTrigger = ${conversationTriggerSource};
  let classificationStyle = document.querySelector('style[' + CLASSIFICATION_STYLE_MARKER + ']');
  if (!classificationStyle) {
    classificationStyle = document.createElement('style');
    classificationStyle.setAttribute(CLASSIFICATION_STYLE_MARKER, '');
    (document.head || document.documentElement).appendChild(classificationStyle);
  }
  classificationStyle.textContent = SECTION_SELECTOR + ' [data-sidebar-chatgpt-conversation-key]:not([' + ROW_CLASSIFICATION_MARKER + ']) { display: none !important; }';
  classificationStyle.textContent += SECTION_SELECTOR + ' [role="list"]:not([' + CHAT_PROXY_LIST + ']) { display: none !important; }';
  if (window.__codexControlConsoleChatSectionVersion === VERSION && window.__codexControlConsoleChatSectionObserver) {
    window.__codexControlConsoleApplyChatSection?.();
    return;
  }
  window.__codexControlConsoleChatSectionObserver?.disconnect?.();

  document.querySelectorAll('[' + TITLE_MARKER + ']').forEach((title) => {
    title.textContent = title.getAttribute(TITLE_MARKER) || title.textContent;
    title.removeAttribute(TITLE_MARKER);
  });
  document.querySelectorAll('[' + LEGACY_HIDDEN_MARKER + ']').forEach((row) => {
    row.style.display = row.getAttribute(LEGACY_HIDDEN_MARKER) || '';
    row.removeAttribute(LEGACY_HIDDEN_MARKER);
  });
  document.querySelectorAll('[' + ORDER_MARKER + ']').forEach((wrapper) => {
    wrapper.style.order = wrapper.getAttribute(ORDER_MARKER) || '';
    wrapper.removeAttribute(ORDER_MARKER);
  });
  document.querySelectorAll('[' + LEGACY_CHAT_ORDER_MARKER + ']').forEach((item) => {
    item.style.order = item.getAttribute(LEGACY_CHAT_ORDER_MARKER) || '';
    item.removeAttribute(LEGACY_CHAT_ORDER_MARKER);
  });
  document.querySelectorAll('[' + LISTITEM_DISPLAY_MARKER + ']').forEach((item) => {
    item.style.display = item.getAttribute(LISTITEM_DISPLAY_MARKER) || '';
    item.removeAttribute(LISTITEM_DISPLAY_MARKER);
  });
  document.querySelectorAll('[' + LEGACY_CLOUD_DIVIDER + ']').forEach((divider) => divider.remove());
  document.querySelectorAll('[' + CLOUD_PROXY_LIST + ']').forEach((list) => list.remove());
  document.querySelectorAll('[' + CHAT_PROXY_LIST + ']').forEach((list) => list.remove());
  document.querySelectorAll('[' + PLACEHOLDER_DISPLAY_MARKER + ']').forEach((placeholder) => {
    placeholder.style.display = placeholder.getAttribute(PLACEHOLDER_DISPLAY_MARKER) || '';
    placeholder.removeAttribute(PLACEHOLDER_DISPLAY_MARKER);
  });
  document.querySelectorAll('[' + LOADING_ITEM_STYLE_MARKER + ']').forEach((item) => {
    item.style.cssText = item.getAttribute(LOADING_ITEM_STYLE_MARKER) || '';
    item.removeAttribute(LOADING_ITEM_STYLE_MARKER);
  });
  document.querySelectorAll('[' + LOADING_WRAP_STYLE_MARKER + ']').forEach((wrap) => {
    wrap.style.cssText = wrap.getAttribute(LOADING_WRAP_STYLE_MARKER) || '';
    wrap.removeAttribute(LOADING_WRAP_STYLE_MARKER);
  });
  document.querySelectorAll('[' + ROW_CLASSIFICATION_MARKER + ']').forEach((item) => item.removeAttribute(ROW_CLASSIFICATION_MARKER));
  const priorToggleBinding = window.__codexControlConsoleChatToggleBinding;
  priorToggleBinding?.toggle?.removeEventListener?.('click', priorToggleBinding.handler, true);

  window.__codexControlConsoleChatSectionVersion = VERSION;
  let pending = false;
  let chatExpanded = localStorage.getItem('codex-control-console.ordinary-chat.expanded') !== 'false';

  function label(section, value) {
    const toggle = section?.querySelector('[data-app-action-sidebar-section-toggle]');
    const title = toggle?.querySelector('.min-w-0.truncate');
    if (title && !title.hasAttribute(TITLE_MARKER)) title.setAttribute(TITLE_MARKER, title.textContent || '');
    if (title && title.textContent !== value) title.textContent = value;
  }

  function readCachedCloudWork() {
    try {
      const value = JSON.parse(localStorage.getItem(CLOUD_CACHE_KEY) || '[]');
      if (!Array.isArray(value)) return [];
      return value.filter((item) => item && typeof item.key === 'string' && typeof item.title === 'string').slice(0, 100);
    } catch {
      return [];
    }
  }

  function openConversation(key, title, addChatTab = false) {
    const match = /^chatgpt:conversation:([0-9a-f-]{36})$/i.exec(key || '');
    if (!match) return;
    if (addChatTab) window.__codexControlConsoleConversationTabs?.openChatgpt?.({ id: match[1], title: String(title || '').trim().slice(0, 160) || 'ChatGPT 会话' });
    const nativeRow = Array.from(document.querySelectorAll('[data-sidebar-chatgpt-conversation-key]')).find((row) => row.getAttribute('data-sidebar-chatgpt-conversation-key') === key);
    const nativeTrigger = conversationTrigger(nativeRow);
    if (nativeTrigger) nativeTrigger.click();
    else window.postMessage({ type: 'navigate-to-route', path: '/c/' + encodeURIComponent(match[1]) }, '*');
  }

  function createProxyItem(record, marker) {
    const item = document.createElement('div');
    item.setAttribute('role', 'listitem');
    const row = document.createElement('div');
    row.setAttribute(marker, record.key);
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.setAttribute('aria-label', record.title);
    row.className = 'group relative flex cursor-interaction items-center text-sm hover:bg-primary-ghost-hover h-[var(--height-token-row)] sidebar-item py-row-y pe-row-y ps-[var(--padding-row-cell-x,var(--padding-row-x))]';
    const title = document.createElement('div');
    title.className = 'min-w-0 flex-1 truncate';
    title.textContent = record.title;
    row.appendChild(title);
    item.appendChild(row);
    return item;
  }

  function renderCloudWork(records) {
    const cloudSection = document.querySelector(CLOUD_SECTION_SELECTOR);
    const nativeList = cloudSection?.querySelector('[role="list"]');
    if (!nativeList) return;
    for (const child of nativeList.children) {
      if (child.hasAttribute(CLOUD_PROXY_LIST)) continue;
      if ((child.textContent || '').trim() !== '将聊天或项目拖到这里') continue;
      if (!child.hasAttribute(PLACEHOLDER_DISPLAY_MARKER)) child.setAttribute(PLACEHOLDER_DISPLAY_MARKER, child.style.display || '');
      child.style.display = records.length ? 'none' : (child.getAttribute(PLACEHOLDER_DISPLAY_MARKER) || '');
    }
    let proxyList = nativeList.querySelector(':scope > [' + CLOUD_PROXY_LIST + ']');
    if (!proxyList) {
      proxyList = document.createElement('div');
      proxyList.setAttribute(CLOUD_PROXY_LIST, '');
      proxyList.className = 'flex flex-col';
      proxyList.addEventListener('click', (event) => {
        const row = event.target.closest('[' + CLOUD_PROXY_ROW + ']');
        if (row) openConversation(row.getAttribute(CLOUD_PROXY_ROW) || '', row.getAttribute('aria-label'));
      });
      proxyList.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const row = event.target.closest('[' + CLOUD_PROXY_ROW + ']');
        if (!row) return;
        event.preventDefault();
        openConversation(row.getAttribute(CLOUD_PROXY_ROW) || '', row.getAttribute('aria-label'));
      });
      nativeList.appendChild(proxyList);
    }
    const signature = JSON.stringify(records);
    if (proxyList.getAttribute('data-cloud-signature') === signature) return;
    proxyList.setAttribute('data-cloud-signature', signature);
    proxyList.replaceChildren(...records.map((record) => createProxyItem(record, CLOUD_PROXY_ROW)));
  }

  function renderOrdinaryChats(section, records) {
    const nativeList = section.querySelector('[role="list"]:not([' + CHAT_PROXY_LIST + '])');
    if (!nativeList) return;
    let proxyList = section.querySelector('[' + CHAT_PROXY_LIST + ']');
    if (!proxyList) {
      proxyList = document.createElement('div');
      proxyList.setAttribute(CHAT_PROXY_LIST, '');
      proxyList.setAttribute('role', 'list');
      proxyList.className = 'flex flex-col';
      proxyList.addEventListener('click', (event) => {
        const row = event.target.closest('[' + CHAT_PROXY_ROW + ']');
        if (row) openConversation(row.getAttribute(CHAT_PROXY_ROW) || '', row.getAttribute('aria-label'), true);
      });
      proxyList.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const row = event.target.closest('[' + CHAT_PROXY_ROW + ']');
        if (!row) return;
        event.preventDefault();
        openConversation(row.getAttribute(CHAT_PROXY_ROW) || '', row.getAttribute('aria-label'), true);
      });
      nativeList.parentElement?.insertBefore(proxyList, nativeList.nextSibling);
    }
    proxyList.style.display = chatExpanded ? '' : 'none';
    const signature = JSON.stringify(records);
    if (proxyList.getAttribute('data-chat-signature') === signature) return;
    proxyList.setAttribute('data-chat-signature', signature);
    proxyList.replaceChildren(...records.map((record) => createProxyItem(record, CHAT_PROXY_ROW)));
  }

  function ownDisclosure(section) {
    const toggle = section.querySelector('[data-app-action-sidebar-section-toggle]');
    if (!toggle) return;
    if (!section.hasAttribute(SOURCE_BOOTSTRAP_MARKER)) {
      section.setAttribute(SOURCE_BOOTSTRAP_MARKER, '');
      if (toggle.getAttribute('aria-expanded') !== 'true') toggle.click();
    }
    const current = window.__codexControlConsoleChatToggleBinding;
    if (current?.toggle !== toggle) {
      current?.toggle?.removeEventListener?.('click', current.handler, true);
      const handler = (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        chatExpanded = !chatExpanded;
        localStorage.setItem('codex-control-console.ordinary-chat.expanded', String(chatExpanded));
        schedule();
      };
      toggle.addEventListener('click', handler, true);
      window.__codexControlConsoleChatToggleBinding = { toggle, handler };
    }
    toggle.setAttribute('aria-expanded', String(chatExpanded));
  }

  function projectLoadingSpinner(section) {
    const spinner = [...section.querySelectorAll('div')]
      .find((item) => typeof item.className === 'string' && item.className.includes('animate-spin'));
    const wrap = spinner?.parentElement;
    const item = spinner?.closest('[role="listitem"]');
    if (!spinner || !wrap || !item) return;
    if (!item.hasAttribute(LOADING_ITEM_STYLE_MARKER)) item.setAttribute(LOADING_ITEM_STYLE_MARKER, item.style.cssText || '');
    if (!wrap.hasAttribute(LOADING_WRAP_STYLE_MARKER)) wrap.setAttribute(LOADING_WRAP_STYLE_MARKER, wrap.style.cssText || '');
    item.style.cssText = (item.getAttribute(LOADING_ITEM_STYLE_MARKER) || '') + ';position:absolute;top:4px;inset-inline-start:64px;width:16px;height:16px;padding:0;z-index:2;';
    wrap.style.cssText = (wrap.getAttribute(LOADING_WRAP_STYLE_MARKER) || '') + ';width:16px;height:16px;padding:0;';
  }

  function apply() {
    for (const section of document.querySelectorAll('section[data-app-action-sidebar-section-heading]')) {
      const key = section.getAttribute('data-app-action-sidebar-section-heading') || '';
      const wrapper = section.parentElement;
      if (wrapper && !wrapper.hasAttribute(ORDER_MARKER)) wrapper.setAttribute(ORDER_MARKER, wrapper.style.order || '');
      if (wrapper) wrapper.style.order = String(SECTION_ORDER.get(key) || 90);
      if (key === 'Projects') label(section, '项目');
      if (key === '项目（聊天）') label(section, '聊天 项目');
    }
    const section = document.querySelector(SECTION_SELECTOR);
    if (!section) return;
    label(section, '聊天');
    ownDisclosure(section);

    for (const item of section.querySelectorAll('[' + LISTITEM_DISPLAY_MARKER + ']')) {
      item.style.display = item.getAttribute(LISTITEM_DISPLAY_MARKER) || '';
      item.removeAttribute(LISTITEM_DISPLAY_MARKER);
    }
    for (const row of section.querySelectorAll('[data-app-action-sidebar-thread-row]')) {
      const item = row.closest('[role="listitem"]');
      if (!item) continue;
      item.setAttribute(LISTITEM_DISPLAY_MARKER, item.style.display || '');
      item.style.display = 'none';
    }

    const conversations = [...section.querySelectorAll('[data-sidebar-chatgpt-conversation-key]')];
    const sourceAnchor = conversations[0];
    const sourceFiberKey = sourceAnchor && Object.getOwnPropertyNames(sourceAnchor).find((name) => name.startsWith('__reactFiber'));
    let sourceFiber = sourceFiberKey ? sourceAnchor[sourceFiberKey] : null;
    while (sourceFiber && !sourceFiber.memoizedProps?.chatGptSource) sourceFiber = sourceFiber.return;
    const targets = sourceFiber?.memoizedProps?.chatGptSource?.chatTargets || [];
    const targetByKey = new Map(targets
      .filter((target) => typeof target?.conversationId === 'string')
      .map((target) => ['chatgpt:conversation:' + target.conversationId, target]));
    const renderedCloudWork = [];
    const renderedOrdinaryChats = [];
    for (const item of conversations) {
      const key = item.getAttribute('data-sidebar-chatgpt-conversation-key') || '';
      const text = (item.textContent || '').trim();
      const target = targetByKey.get(key);
      const kind = target ? classifyRecentTarget(target) : (text.endsWith('工作') ? 'cloud-work' : 'ordinary-chat');
      item.setAttribute(ROW_CLASSIFICATION_MARKER, kind);
      if (kind === 'ordinary-chat') {
        if (key) renderedOrdinaryChats.push({ key, title: text.replace(/聊天$/, '') });
        continue;
      }
      if (kind === 'cloud-work' && key) renderedCloudWork.push({ key, title: text.replace(/工作$/, '') });
      if (!item.hasAttribute(LISTITEM_DISPLAY_MARKER)) item.setAttribute(LISTITEM_DISPLAY_MARKER, item.style.display || '');
      item.style.display = 'none';
    }
    const cloudWork = renderedCloudWork.length ? renderedCloudWork : readCachedCloudWork();
    if (renderedCloudWork.length) localStorage.setItem(CLOUD_CACHE_KEY, JSON.stringify(renderedCloudWork.slice(0, 100)));
    renderCloudWork(cloudWork);
    renderOrdinaryChats(section, renderedOrdinaryChats);
  }

  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; apply(); });
  }

  window.__codexControlConsoleApplyChatSection = apply;
  window.__codexControlConsoleChatSectionObserver = new MutationObserver(schedule);
  window.__codexControlConsoleChatSectionObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['data-sidebar-chatgpt-conversation-key', 'data-app-action-sidebar-section-heading', 'aria-expanded']
  });
  apply();
})()`;
}
