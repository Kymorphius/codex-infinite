import { BUTLER_ENGINE } from './butler-prompt.mjs';

export function parseButlerLink(href) {
  const match = /^#ccc-open\/(local|chatgpt|terminal)\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/.exec(typeof href === 'string' ? href : '');
  return match ? { kind: match[1], id: match[2].toLowerCase() } : null;
}

// Additive top-action entry that opens one persistent read-only native thread; native rows stay React-owned.
export function installNativeButlerEntry(options, parseLink) {
  const VERSION = '2026-09-29.butler1';
  if (window.__cccButlerEntry?.version === VERSION && window.__cccButlerEntry.cwd === options.cwd) { window.__cccButlerEntry.place(); return; }
  window.__cccButlerEntry?.dispose?.();
  document.querySelectorAll('[data-codex-control-console-butler-entry]').forEach(node => node.remove());
  const ENTRY = 'data-codex-control-console-butler-entry', KEY = 'codex-control-console.butler.v1', TITLE = '管家 · 管理全部会话';
  const ROOT = '[data-thread-user-message-navigation-content],[data-app-action-timeline-scroll]';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const { cwd, engine } = options;
  const trimPath = value => String(value || '').replace(/\/+$/, '');
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  const buttonBy = labels => Array.from(document.querySelectorAll('button,[role="button"]')).find(node => {
    const value = normalize(node.getAttribute('aria-label') || node.textContent);
    if (!labels.some(label => value === label || value.startsWith(label + ' '))) return false;
    const rect = node.getBoundingClientRect?.();
    return !rect || rect.width > 0 && rect.height > 0;
  });
  function readStored() {
    try { const value = JSON.parse(localStorage.getItem(KEY) || 'null'); return UUID.test(value?.threadId || '') ? { threadId: value.threadId.toLowerCase(), cwd: typeof value.cwd === 'string' ? value.cwd : '' } : null; }
    catch { return null; }
  }
  function store(threadId, resolvedCwd = '') { try { localStorage.setItem(KEY, JSON.stringify(resolvedCwd ? { threadId, cwd: resolvedCwd } : { threadId })); } catch {} hideRow(threadId); }
  const cwdMatches = value => { const actual = trimPath(value); return Boolean(actual) && (actual === trimPath(cwd) || actual === trimPath(readStored()?.cwd)); };
  let sequence = 0;
  function request(method, params) {
    const bridge = window.electronBridge?.sendMessageFromView;
    if (typeof bridge !== 'function') return Promise.reject(new Error('原生会话桥接尚未就绪'));
    const id = 'codex-control-butler-' + Date.now() + '-' + (++sequence);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { cleanup(); reject(new Error('原生会话请求超时')); }, 8000);
      const receive = event => {
        const data = event.data;
        if (data?.type !== 'mcp-response' || data?.hostId !== 'local' || data?.message?.id !== id) return;
        cleanup();
        if (data.message.error) reject(new Error(data.message.error.message || '原生会话请求失败'));
        else resolve(data.message.result);
      };
      const cleanup = () => { clearTimeout(timeout); window.removeEventListener('message', receive); };
      window.addEventListener('message', receive);
      Promise.resolve(bridge.call(window.electronBridge, { type: 'mcp-request', hostId: 'local', retainResponse: true, request: { id, method, params } }))
        .catch(error => { cleanup(); reject(error); });
    });
  }
  const archived = thread => Boolean(thread?.archived) || /[\\/]archived_sessions[\\/]/.test(String(thread?.path || ''));
  const time = value => typeof value === 'number' ? value : Date.parse(value || '') || 0;
  async function resolveThread() {
    const saved = readStored();
    if (saved) {
      const thread = (await request('thread/read', { threadId: saved.threadId, includeTurns: false }).catch(() => null))?.thread;
      if (thread && String(thread.id || '').toLowerCase() === saved.threadId && cwdMatches(thread.cwd) && !archived(thread)) {
        if (thread.name !== '管家') await request('thread/name/set', { threadId: saved.threadId, name: '管家' }).catch(() => {});
        return { id: saved.threadId, created: false };
      }
    }
    const listed = await request('thread/list', { cwd, archived: false, limit: 10, sortKey: 'updated_at' });
    const found = (Array.isArray(listed?.data) ? listed.data : []).filter(thread => UUID.test(thread?.id || '') && cwdMatches(thread.cwd) && !archived(thread))
      .sort((a, b) => time(b.updatedAt) - time(a.updatedAt))[0];
    if (found) { store(found.id.toLowerCase(), found.cwd === cwd ? '' : found.cwd); return { id: found.id.toLowerCase(), created: false }; }
    const started = await request('thread/start', { cwd, ephemeral: false, sandbox: 'read-only', approvalPolicy: 'never' });
    const id = String(started?.thread?.id || '').toLowerCase();
    if (!UUID.test(id)) throw new Error('原生会话没有返回管家 ID');
    const resolvedCwd = started.thread.cwd || started.cwd || '';
    store(id, resolvedCwd && trimPath(resolvedCwd) !== trimPath(cwd) ? resolvedCwd : '');
    await request('thread/name/set', { threadId: id, name: '管家' }).catch(() => {});
    return { id, created: true };
  }
  async function openLocal(id, title) {
    window.__codexControlConsoleConversationTabs?.openLocal?.({ id, title });
    if (typeof window.__codexControlConsoleOpenNativeThread === 'function') {
      try { await window.__codexControlConsoleOpenNativeThread(id); return; } catch {}
    }
    window.postMessage({ type: 'navigate-to-route', path: '/local/' + encodeURIComponent(id) }, '*');
  }
  let errorTimer = 0, inflight = null, disposed = false, scheduled = false;
  function setState(state, title) {
    clearTimeout(errorTimer);
    if (state) button.setAttribute('data-state', state); else button.removeAttribute('data-state');
    button.title = title || TITLE;
    if (state === 'error') errorTimer = setTimeout(() => setState(''), 4000);
  }
  async function run() {
    setState('busy');
    try {
      const { id, created } = await resolveThread();
      let note = '';
      if (engine?.provider === 'claude-router') {
        const ready = window.__cccClaudeRouterReady?.() === true && typeof window.__cccClaudePreviewSet === 'function';
        if (!ready) note = TITLE + '（Router 未就绪，当前使用 GPT）';
        else if (created || window.__cccClaudePreviewBlocks?.(id) !== true) {
          try { await window.__cccClaudePreviewSet(id, engine.effort, engine.nativeTools, engine.family); }
          catch (error) { note = TITLE + '（未切换到 Claude：' + String(error?.message || '未知错误') + '）'; }
        }
      }
      await openLocal(id, '管家');
      setState(note ? 'note' : '', note);
      return id;
    } catch (error) {
      setState('error', '管家打开失败：' + String(error?.message || '未知错误'));
      return null;
    }
  }
  const openButler = () => inflight || (inflight = run().finally(() => { inflight = null; }));
  const style = document.createElement('style'); style.setAttribute(ENTRY + '-style', '');
  function hideRow(id) {
    const css = UUID.test(id || '') ? '[data-app-action-sidebar-thread-id="local:' + id + '"]{display:none!important}' : '';
    if (style.textContent !== css) style.textContent = css;
    if (!style.isConnected) (document.head || document.documentElement).append(style);
  }
  const currentId = () => {
    const ids = Array.from(document.querySelectorAll('[data-above-composer-conversation-id]'), node => String(node.getAttribute('data-above-composer-conversation-id') || '').replace(/^local:/i, '').toLowerCase());
    return ids.reverse().find(id => UUID.test(id)) || '';
  };
  const inButler = node => Boolean(node?.closest?.(ROOT)) && Boolean(readStored()) && currentId() === readStored().threadId;
  function dispatch(link, title) {
    if (link.kind === 'local') { void openLocal(link.id, title).catch(() => {}); return; }
    if (link.kind === 'chatgpt') {
      const tabs = window.__codexControlConsoleConversationTabs;
      if (typeof tabs?.openChatgpt === 'function') tabs.openChatgpt({ id: link.id, title });
      else window.postMessage({ type: 'navigate-to-route', path: '/c/' + encodeURIComponent(link.id) }, '*');
      return;
    }
    const record = window.__cccTerminalConversations?.records?.()?.find?.(item => item.id === link.id);
    void Promise.resolve(window.__codexControlConsoleOpenTerminalConversation?.(record || { provider: 'terminal', conversationId: link.id })).catch(() => {});
  }
  function onClick(event) {
    const anchor = event.target?.closest?.('a[href^="#ccc-open/"],code[data-ccc-butler-link]');
    if (!anchor || !inButler(anchor)) return;
    const link = parseLink(anchor.tagName === 'CODE' || anchor.localName === 'code' ? anchor.getAttribute('data-ccc-butler-link') : anchor.getAttribute('href'));
    if (!link) return;
    event.preventDefault(); event.stopImmediatePropagation();
    dispatch(link, normalize(anchor.textContent).slice(0, 120) || '会话');
  }
  function decorate() {
    if (!readStored() || currentId() !== readStored().threadId) return;
    for (const root of document.querySelectorAll(ROOT)) for (const code of root.querySelectorAll('code')) {
      if (code.closest?.('a')) continue;
      const text = normalize(code.textContent), href = parseLink('#' + text.replace(/^#/, '')) ? '#' + text.replace(/^#/, '') : '';
      if ((code.getAttribute('data-ccc-butler-link') || '') === href) continue;
      if (href) { code.setAttribute('data-ccc-butler-link', href); code.setAttribute('role', 'link'); code.style.cursor = 'pointer'; }
      else { code.removeAttribute('data-ccc-butler-link'); code.removeAttribute('role'); code.style.cursor = ''; }
    }
  }
  const button = document.createElement('button');
  button.type = 'button'; button.setAttribute(ENTRY, ''); button.setAttribute('aria-label', TITLE); button.title = TITLE;
  button.innerHTML = '<span aria-hidden="true" style="display:inline-flex;width:1.1rem;height:1.1rem;align-items:center;justify-content:center"><svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M3.5 14.5a6.5 6.5 0 0 1 13 0z" stroke-linejoin="round"/><path d="M2.5 16.75h15M10 8V6M8.5 5.25h3"/></svg></span><span class="truncate">管家</span>';
  button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); void openButler(); });
  function place() {
    if (disposed) return;
    const openProject = document.querySelector('[data-codex-control-console-open-local-project]');
    const newChat = buttonBy(['新聊天', '新对话', '新建任务', 'New chat', 'New task']);
    const parent = openProject?.parentElement || newChat?.parentElement;
    if (parent) {
      if (newChat && button.className !== newChat.className) button.className = newChat.className;
      if (openProject?.parentElement === parent) { if (button.parentElement !== parent || openProject.previousElementSibling !== button) parent.insertBefore(button, openProject); }
      else if (newChat && (button.parentElement !== parent || button.previousElementSibling !== newChat)) parent.insertBefore(button, newChat.nextSibling);
    }
    decorate();
  }
  function schedule() { if (disposed || scheduled) return; scheduled = true; requestAnimationFrame(() => { scheduled = false; place(); }); }
  const observer = new MutationObserver(schedule); observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('click', onClick, true); document.addEventListener('auxclick', onClick, true);
  hideRow(readStored()?.threadId || '');
  window.__cccButlerEntry = { version: VERSION, cwd, place, dispose() {
    disposed = true; clearTimeout(errorTimer); observer.disconnect(); button.remove(); style.remove();
    document.removeEventListener('click', onClick, true); document.removeEventListener('auxclick', onClick, true);
  } };
  window.__cccButler = { open: openButler, id: () => readStored()?.threadId || '' };
  place();
}

export function buildNativeButlerEntryScript({ cwd = '', engine = BUTLER_ENGINE } = {}) {
  return `(${installNativeButlerEntry.toString()})(${JSON.stringify({ cwd: String(cwd), engine })}, ${parseButlerLink.toString()});`;
}
