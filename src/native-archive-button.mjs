// "归档" beside 讨论: archive the active GPT or Claude conversation after a confirmation dialog.
// GPT goes through the native app's own `thread/archive` request (the same path its sidebar
// uses); Claude goes through the terminal conversation service. `closeTab` retires the tab.
export function installNativeArchiveButton({ documentRef, root, activeTab, closeTab }) {
  const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  const NAME = { claude: 'Claude', gpt: 'GPT' };
  const svg = (name) => documentRef.createElementNS('http://www.w3.org/2000/svg', name);
  const el = (tag, className, text) => {
    const node = documentRef.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const host = el('div', 'ccc-native-recent ccc-native-archive');
  const button = el('button', 'ccc-native-recent-trigger');
  button.type = 'button';
  button.setAttribute('aria-haspopup', 'dialog');
  const icon = svg('svg');
  for (const [key, value] of [['class', 'ccc-native-recent-icon'], ['aria-hidden', 'true'], ['viewBox', '0 0 24 24'], ['fill', 'none'], ['stroke', 'currentColor'], ['stroke-width', '1.8'], ['stroke-linecap', 'round'], ['stroke-linejoin', 'round']]) icon.setAttribute(key, value);
  const path = svg('path');
  path.setAttribute('d', 'M4 5h16v4H4zM5 9v10h14V9M10 13h4');
  icon.append(path);
  button.append(icon, el('span', '', '归档'));
  host.append(button);
  root.append(host);

  const notify = (message) => {
    const node = el('div', '', message);
    node.setAttribute('role', 'status');
    node.style.cssText = 'position:fixed;z-index:2147483647;bottom:28px;left:50%;transform:translateX(-50%);padding:8px 12px;border-radius:8px;background:var(--color-background-primary,#252525);color:var(--color-text);font:13px/20px -apple-system,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.28)';
    documentRef.body.append(node); setTimeout(() => node.remove(), 3500);
  };
  const roleOf = (tab) => tab?.kind === 'local' && UUID.test(tab.id || '') ? 'gpt' : tab?.kind === 'terminal' && tab.engine === 'claude' ? 'claude' : '';
  const update = () => {
    const role = roleOf(activeTab());
    const text = role ? '归档当前 ' + NAME[role] + ' 会话' : '打开一个 GPT 或 Claude 会话后可归档';
    if (button.disabled !== !role) button.disabled = !role;
    if (button.title !== text) { button.title = text; button.setAttribute('aria-label', '归档：' + text); }
  };

  // The native renderer answers its own mcp-request messages; nothing here is a console endpoint.
  let sequence = 0;
  const archiveGpt = (threadId) => new Promise((resolve, reject) => {
    const bridge = window.electronBridge;
    if (typeof bridge?.sendMessageFromView !== 'function') return reject(Error('原生归档入口不可用'));
    const id = 'ccc-archive-' + Date.now() + '-' + (++sequence);
    const finish = (message) => {
      clearTimeout(timer); window.removeEventListener('message', receive);
      if (message?.error) reject(Error(message.error.message || '归档失败')); else resolve(message?.result);
    };
    const receive = (event) => { const data = event.data; if (data?.type === 'mcp-response' && data?.hostId === 'local' && data.message?.id === id) finish(data.message); };
    const timer = setTimeout(() => finish({ error: { message: '归档请求超时，结果未知，请查看侧栏后再试' } }), 20000);
    window.addEventListener('message', receive);
    try { bridge.sendMessageFromView({ type: 'mcp-request', hostId: 'local', retainResponse: true, request: { id, method: 'thread/archive', params: { threadId } } }); }
    catch (error) { finish({ error: { message: String(error?.message || error) } }); }
  });
  const archiveClaude = async (id) => {
    const terminals = window.__cccTerminalConversations;
    const record = terminals?.records?.().find((item) => item.id === id);
    if (!record || typeof terminals.request !== 'function') throw Error('找不到这个 Claude 会话，请刷新后重试');
    const result = await terminals.request('update', { id, expectedRevision: record.revision, archived: true });
    terminals.accept?.(result.conversation);
  };

  let dialog = null, busy = false;
  const dismiss = () => { dialog?.close?.(); dialog?.remove(); dialog = null; };
  function confirm(tab, role) {
    dismiss();
    dialog = el('dialog', 'ccc-native-archive-dialog');
    dialog.setAttribute('aria-label', '归档会话');
    const title = tab.title ? '「' + (tab.title.length > 60 ? tab.title.slice(0, 60) + '…' : tab.title) + '」' : '当前 ' + NAME[role] + ' 会话';
    const actions = el('div', 'ccc-native-archive-actions');
    const cancel = el('button', 'ccc-native-archive-cancel', '取消'); cancel.type = 'button';
    const ok = el('button', 'ccc-native-archive-confirm', '归档'); ok.type = 'button';
    actions.append(cancel, ok);
    dialog.append(el('h3', '', '归档会话？'), el('p', '', '将归档' + title + '，它会从侧栏和标签页中移除，之后可在已归档会话中恢复。'), actions);
    cancel.addEventListener('click', (event) => { event.preventDefault(); dismiss(); button.focus(); });
    ok.addEventListener('click', async (event) => {
      event.preventDefault();
      if (busy) return;
      busy = true; ok.disabled = true; cancel.disabled = true;
      try {
        if (role === 'gpt') await archiveGpt(tab.id); else await archiveClaude(tab.id);
        dismiss(); closeTab?.(tab); notify('已归档' + title);
      } catch (error) { ok.disabled = false; cancel.disabled = false; notify('归档失败：' + String(error?.message || error)); }
      finally { busy = false; }
    });
    dialog.addEventListener('keydown', (event) => event.stopPropagation());
    dialog.addEventListener('close', () => { if (dialog && !busy) { dialog.remove(); dialog = null; } });
    documentRef.body.append(dialog);
    dialog.showModal?.();
    cancel.focus?.();
  }

  button.addEventListener('click', (event) => {
    event.preventDefault(); event.stopPropagation();
    const tab = activeTab(), role = roleOf(tab);
    if (button.disabled || !role) return;
    confirm(tab, role);
  });
  update();
  return { update, destroy() { dismiss(); host.remove(); } };
}

export const NATIVE_ARCHIVE_STYLE = '.ccc-native-archive-dialog{padding:20px;min-width:320px;max-width:min(420px,calc(100vw - 32px));border:1px solid rgba(127,127,127,.35);border-radius:14px;background:var(--color-background-primary,#252525);color:var(--color-text-primary,#eee);font:13px/20px -apple-system,sans-serif}.ccc-native-archive-dialog h3{margin:0 0 8px;font-size:15px}.ccc-native-archive-dialog p{margin:0 0 16px;opacity:.8;overflow-wrap:anywhere}.ccc-native-archive-actions{display:flex;justify-content:flex-end;gap:8px}.ccc-native-archive-actions button{padding:5px 14px;border-radius:7px;border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;font-size:12px;cursor:pointer}.ccc-native-archive-actions .ccc-native-archive-confirm{background:#d93f3f;border-color:transparent;color:#fff}.ccc-native-archive-actions button:disabled{opacity:.4;cursor:default}';
