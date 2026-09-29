import { requestJson } from '../../core/transport.js';
import { createTerminalSession } from './session.js';
import { createTerminalComposer, isAbsoluteTerminalDirectory, shouldSubmitTerminalDraft, terminalMessage, terminalStatus } from './presentation.js';
import { createTerminalTasks, renderTerminalTasks } from './tasks.js';
import { createTerminalMirror } from './mirror.js';

export function createManagedTerminalFeature({ state, $, showToast, request = requestJson, createView = createTerminalSession }) {
  const panel = $('[data-module-panel="terminal"]'), viewport = $('[data-testid="terminal-viewport"]');
  const input = $('[data-testid="terminal-composer-input"]'), form = $('[data-testid="terminal-composer"]');
  const taskPanel = $('[data-terminal-task-panel]'), views = new Map(), runtimes = new Map();
  let selected = null, requestedId = '', deviceId = '', reference = {}, generation = 0, active = false, disposed = false, bound = false, busy = false, composing = false;
  let loading = null, records = [], pendingClose = '';
  let storage;
  try { storage = globalThis.sessionStorage; } catch { /* Optional browser draft storage. */ }
  const composer = createTerminalComposer({ getView: id => views.get(id), onChange: renderComposer, storage, storageKey: id => `terminal-draft.v1:${deviceId}:${id}` });
  const tasks = createTerminalTasks({ request, getConversation: () => selected, getDraft: composer.draft,
    setDraft: text => composer.setDraft(text), onChange: renderTasks, storage });
  const post = (operation, body) => request(`/api/terminal-conversations/${operation}`, { method: 'POST', body });
  const mirror = createTerminalMirror({ host: $('[data-testid="terminal-mirror"]'), request, onChange: () => renderComposer() });
  // A companion Claude session is mirrored while no interactive Claude runs here (see mirror.js).
  const mirroring = () => Boolean(selected?.companionOf && !selected.archived && !(selected.runtimeSessionId && selected.status === 'running'));
  function announce(type, conversation) {
    if (typeof window !== 'undefined' && window.parent !== window) window.parent.postMessage({ type: `codex-control-console-terminal-conversation-${type}`, conversation }, 'app://-');
  }
  function error(message = '') {
    $('[data-testid="terminal-error"]').textContent = message;
    $('[data-testid="terminal-error"]').classList.toggle('hidden', !message);
  }
  function route(id) {
    const url = new URL(location.href);
    url.searchParams.set('module', 'terminal'); url.searchParams.delete('session');
    if (id) url.searchParams.set('conversationId', id); else url.searchParams.delete('conversationId');
    if (state.module === 'terminal') history.replaceState(null, '', url);
  }
  function renderTasks(snapshot = tasks.snapshot()) {
    renderTerminalTasks(taskPanel, snapshot);
    $('[data-terminal-task-todos]').textContent = `待办 ${snapshot.assigned.length}`;
    $('[data-terminal-task-claim]').textContent = `领任务 ${snapshot.inbox.length}`;
    $('[data-terminal-task-save]').disabled = busy || snapshot.pending || !selected || !composer.draft().trim();
    $('[data-terminal-task-notice]').textContent = snapshot.error || snapshot.notice;
    $('[data-terminal-task-notice]').classList.toggle('hidden', !snapshot.error && !snapshot.notice);
  }
  function renderComposer() {
    if (!form) return;
    const snapshot = composer.snapshot();
    form.classList.toggle('hidden', !selected);
    if (input.value !== snapshot.draft) input.value = snapshot.draft;
    input.placeholder = selected?.kind === 'claude' ? '输入消息或 /命令…' : '输入命令…';
    input.style.height = 'auto'; input.style.height = `${Math.min(112, Math.max(58, input.scrollHeight))}px`;
    const mirrored = mirroring(), view = mirror.snapshot();
    for (const button of form.querySelectorAll('[data-terminal-send], [data-terminal-paste]')) button.disabled = busy || !snapshot.draft.trim() || (mirrored ? view.sending || button.hasAttribute('data-terminal-paste') : !snapshot.canSend);
    for (const button of form.querySelectorAll('[data-terminal-key]')) button.disabled = busy || mirrored || !snapshot.canInput;
    $('[data-terminal-focus]').disabled = mirrored || !snapshot.canInput;
    $('[data-terminal-send]').setAttribute('aria-busy', String(snapshot.sending));
    $('[data-testid="terminal-session-kind"]').textContent = selected?.kind === 'claude' ? 'Claude CLI' : 'Shell';
    $('[data-testid="terminal-composer-hint"]').textContent = mirrored ? (view.sending ? '正在发送…' : view.status || 'Enter 发送 · 每条消息单独执行，Codex 随时可发')
      : snapshot.sending ? '正在交给终端…' : !snapshot.canInput ? '终端未就绪，仍可编辑草稿或存待办' : 'Enter 发送 · Shift+Enter 换行';
    if (bound) renderTasks();
  }
  function render() {
    const snapshot = views.get(selected?.id)?.snapshot();
    $('[data-testid="terminal-session-bar"]').classList.toggle('hidden', !selected);
    $('[data-testid="terminal-session-title"]').textContent = selected?.title || '终端会话';
    $('[data-testid="terminal-status"]').textContent = !selected ? '' : selected.archived ? '已归档' : selected.status === 'stopped' ? '已停止' : terminalStatus(snapshot?.session || selected, snapshot?.connection);
    $('[data-testid="terminal-path"]').textContent = selected?.cwd || '';
    $('[data-testid="terminal-path"]').title = selected?.cwd || '';
    $('[data-terminal-close]').disabled = busy || !selected?.runtimeSessionId;
    $('[data-terminal-reconnect]').classList.toggle('hidden', !selected?.runtimeSessionId || !['disconnected', 'takenover', 'error'].includes(snapshot?.connection));
    $('[data-testid="terminal-replay-note"]').classList.toggle('hidden', !snapshot?.session.replayTruncated);
    const stopped = selected && (!selected.runtimeSessionId || selected.status === 'stopped');
    const restartable = selected && (stopped || selected.status === 'exited'), mirrored = mirroring();
    if (mirrored && active) mirror.show(selected.id); else mirror.hide();
    if (mirrored) $('[data-testid="terminal-status"]').textContent = '实时镜像';
    $('[data-testid="terminal-empty"]').classList.toggle('hidden', Boolean(selected && (!stopped || mirrored)));
    $('[data-testid="terminal-empty-message"]').textContent = selected?.archived ? '会话已归档，可在会话管理中恢复。' : stopped ? '会话已保留。启动后继续使用终端。' : requestedId ? '正在打开会话…' : '从项目或会话列表打开 Claude CLI 与终端会话。';
    $('[data-terminal-start]').classList.toggle('hidden', !restartable || selected.archived);
    $('[data-terminal-start]').textContent = mirrored ? '交互模式' : selected?.status === 'exited' ? '重新启动' : '启动会话';
    $('[data-terminal-start]').title = mirrored ? '启动完整的交互式 Claude（斜杠命令等）；期间 Codex 会提示会话被占用，退出后回到镜像' : '';
    $('[data-terminal-start]').disabled = busy;
    viewport.classList.toggle('hidden', !selected || Boolean(stopped) || mirrored);
    const tabs = $('[data-testid="terminal-tabs"]');
    tabs.replaceChildren(...records.filter(item => !item.archived && (!reference.cwd || item.cwd === reference.cwd)).map(item => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'terminal-tab';
      button.dataset.conversationId = item.id; button.textContent = item.title; button.setAttribute('aria-selected', String(item.id === selected?.id));
      return button;
    }));
    renderComposer();
  }
  function useConversation(conversation, event = 'opened') {
    deviceId ||= conversation.deviceId;
    selected = conversation;
    records = [...records.filter(item => item.id !== conversation.id), conversation];
    composer.select(conversation.id); route(conversation.id);
    for (const [id, view] of views) if (id !== conversation.id) view.deactivate();
    const oldRuntime = runtimes.get(conversation.id);
    if (oldRuntime && oldRuntime !== conversation.runtimeSessionId) { views.get(conversation.id)?.dispose(); views.delete(conversation.id); runtimes.delete(conversation.id); }
    if (conversation.runtimeSessionId && !views.has(conversation.id)) {
      if (!globalThis.Terminal || !globalThis.FitAddon?.FitAddon) { error('终端界面未能加载，请刷新重试。'); render(); return; }
      const host = document.createElement('div'); host.className = 'terminal-screen'; host.id = `terminal-screen-${conversation.id}`; host.setAttribute('aria-label', conversation.title);
      viewport.append(host);
      const runtime = { ...conversation, ...conversation.runtimeSummary, id: conversation.runtimeSessionId, cols: conversation.runtimeSummary?.cols || 100, rows: conversation.runtimeSummary?.rows || 30 };
      let initial = true;
      const view = createView(runtime, { host, onChange(snapshot) {
        if (initial || selected?.id !== conversation.id || selected.runtimeSessionId !== runtime.id) return;
        if (snapshot.session.status === 'exited' && selected.status !== 'exited') { selected = { ...selected, status: 'exited' }; announce('updated', selected); }
        error(snapshot.error); render();
      } });
      initial = false; views.set(conversation.id, view); runtimes.set(conversation.id, conversation.runtimeSessionId);
    }
    error(conversation.runtimeError || ''); render();
    if (active && !conversation.archived) views.get(conversation.id)?.activate();
    else views.get(conversation.id)?.deactivate();
    if (event) announce(event, conversation); render();
  }
  async function load() {
    active = true;
    if (disposed) return;
    if (loading) return loading;
    const revision = generation, id = requestedId;
    loading = (async () => {
      try {
        const result = await post('list', {});
        if (disposed || revision !== generation) return;
        deviceId = result.deviceId; records = result.conversations;
        if (reference.deviceId && reference.deviceId !== deviceId) throw Error('此会话属于另一台设备，无法在本机打开。');
        if (!$('[data-testid="terminal-cwd"]').value) $('[data-testid="terminal-cwd"]').value = reference.cwd || result.defaultCwd || '';
        if (id) {
          const response = await post('open', { id });
          if (disposed || revision !== generation) return;
          useConversation(response.conversation);
        } else render();
        void tasks.load();
      } catch (failure) { if (!disposed && revision === generation) { render(); error(terminalMessage(failure, '暂时无法打开会话，请刷新重试。')); } }
      finally { loading = null; if (!disposed && active && revision !== generation) void load(); }
    })();
    return loading;
  }
  function openReference(value) {
    ++generation; selected = null;
    for (const view of views.values()) view.deactivate();
    const id = value?.conversationId || '';
    if (value?.provider !== 'terminal' || typeof id !== 'string' || id && !/^[a-zA-Z0-9_-]{1,80}$/u.test(id)) {
      requestedId = ''; reference = {}; render(); error('终端会话标识无效。'); return false;
    }
    if (id) document.body?.classList.add('terminal-conversation-view');
    reference = value; requestedId = id; composer.select(''); tasks.select(); route(id); render();
    document.body?.classList.toggle('terminal-conversation-view', Boolean(id) || new URLSearchParams(location.search).get('view') === 'conversation');
    if (!loading) void load();
    return true;
  }
  function acceptUpdate(record) {
    if (disposed || !selected || record?.provider !== 'terminal' || record.id !== selected.id || record.deviceId !== selected.deviceId) return false;
    ++generation; useConversation(record, null); return true;
  }
  function receiveUpdate(event) {
    if (event.source === window.parent && event.origin === 'app://-' && event.data?.type === 'codex-control-console-terminal-record-changed') acceptUpdate(event.data.conversation);
  }
  async function mutate(operation, body) {
    if (busy) return;
    const revision = generation;
    busy = true; error(); render();
    try {
      const { conversation } = await post(operation, body);
      if (disposed) return;
      announce('updated', conversation);
      if (revision === generation) { requestedId = conversation.id; useConversation(conversation, 'updated'); }
    } catch (failure) { if (revision === generation) error(terminalMessage(failure, '会话操作未完成，请刷新核对。')); }
    finally { busy = false; render(); }
  }
  async function send(submit) {
    const id = selected?.id; error();
    if (mirroring()) {
      const text = composer.draft();
      if (!submit || !text.trim()) return;
      try { await mirror.send(text); if (selected?.id === id) composer.setDraft(''); } catch (failure) { error(terminalMessage(failure, '发送失败，请重试。')); }
      return;
    }
    const result = await composer.send({ submit });
    if (selected?.id !== id || disposed) return;
    if (!result.ok) error(result.message);
    else if (!submit) { showToast('已粘贴到终端，尚未发送 Enter'); views.get(id)?.focus(); }
    else input.focus();
  }
  function bind() {
    if (bound) return; bound = true;
    window.addEventListener('message', receiveUpdate);
    const params = new URLSearchParams(location.search);
    const conversationMode = params.get('view') === 'conversation' || params.has('conversationId');
    document.body?.classList.toggle('terminal-conversation-view', state.module === 'terminal' && conversationMode);
    panel.classList.toggle('terminal-managed', true);
    $('[data-terminal-task-controls]').classList.remove('hidden');
    panel.querySelector('.terminal-keys-menu').append($('[data-terminal-direct-controls]'));
    $('[data-terminal-close]').setAttribute('aria-label', '停止终端进程');
    $('[data-terminal-close]').title = '停止终端进程';
    const stopDialog = $('[data-testid="terminal-close-dialog"]');
    stopDialog.querySelector('h3').textContent = '停止当前终端进程？';
    stopDialog.querySelector('p').textContent = '会话和待办会保留。重新启动后可继续使用终端。';
    $('[data-terminal-close-cancel]').textContent = '继续运行';
    $('[data-terminal-close-confirm]').textContent = '停止进程';
    $('[data-terminal-start]').addEventListener('click', () => selected && void mutate('start', { id: selected.id }));
    $('[data-terminal-refresh]').addEventListener('click', () => void load());
    $('[data-terminal-reconnect]').addEventListener('click', () => views.get(selected?.id)?.reconnect());
    $('[data-terminal-close]').addEventListener('click', () => {
      if (!selected) return; pendingClose = selected.id;
      $('[data-testid="terminal-close-name"]').textContent = selected.title;
      $('[data-testid="terminal-close-dialog"]').showModal();
    });
    $('[data-terminal-close-cancel]').addEventListener('click', () => $('[data-testid="terminal-close-dialog"]').close());
    $('[data-terminal-close-confirm]').addEventListener('click', () => { $('[data-testid="terminal-close-dialog"]').close(); void mutate('stop', { id: pendingClose }); });
    $('[data-testid="terminal-tabs"]').addEventListener('click', event => {
      const button = event.target.closest('[data-conversation-id]');
      if (button) openReference({ provider: 'terminal', conversationId: button.dataset.conversationId });
    });
    for (const button of panel.querySelectorAll('[data-terminal-create]')) button.addEventListener('click', () => {
      const cwd = $('[data-testid="terminal-cwd"]').value.trim();
      if (!isAbsoluteTerminalDirectory(cwd)) return error('请填写完整的工作目录路径。');
      void mutate('create', { cwd, kind: button.dataset.terminalCreate, ...(reference.projectRef ? { projectRef: reference.projectRef } : {}) });
    });
    $('[data-terminal-same-directory]').addEventListener('click', () => selected && void mutate('create', { cwd: selected.cwd, kind: 'shell', projectRef: selected.projectRef }));
    input.addEventListener('input', () => composer.setDraft(input.value));
    input.addEventListener('compositionstart', () => { composing = true; });
    input.addEventListener('compositionend', () => { composing = false; composer.setDraft(input.value); });
    input.addEventListener('keydown', event => { if (shouldSubmitTerminalDraft(event, composing)) { event.preventDefault(); void send(true); } });
    form.addEventListener('submit', event => { event.preventDefault(); if (!composing) void send(true); });
    $('[data-terminal-paste]').addEventListener('click', () => { if (!composing) void send(false); });
    $('[data-terminal-focus]').addEventListener('click', () => views.get(selected?.id)?.focus());
    for (const button of form.querySelectorAll('[data-terminal-key]')) button.addEventListener('click', () => {
      const result = views.get(selected?.id)?.sendKey(button.dataset.terminalKey);
      if (result && !result.ok) error(result.message); else views.get(selected?.id)?.focus();
      $('[data-terminal-keys]').open = false;
    });
    $('[data-terminal-task-save]').addEventListener('click', () => void tasks.save());
    $('[data-terminal-task-todos]').addEventListener('click', () => tasks.open('assigned'));
    $('[data-terminal-task-claim]').addEventListener('click', () => tasks.open('inbox'));
    $('[data-terminal-task-dismiss]').addEventListener('click', tasks.close);
    taskPanel.addEventListener('click', event => {
      const button = event.target.closest('[data-terminal-task-action]');
      if (!button) return;
      if (button.dataset.terminalTaskAction === 'insert') { if (tasks.insert(button.dataset.taskKey)) input.focus(); }
      else void tasks.mutate(button.dataset.terminalTaskAction, button.dataset.taskKey);
    });
    render();
    if (state.module === 'terminal') openReference({ provider: 'terminal', conversationId: params.get('conversationId') || '', cwd: params.get('cwd') || '' });
  }
  return { bind, load, openReference, acceptUpdate,
    deactivate() { active = false; mirror.hide(); document.body?.classList.remove('terminal-conversation-view'); for (const view of views.values()) view.deactivate(); },
    dispose() { window.removeEventListener('message', receiveUpdate); disposed = true; mirror.dispose(); ++generation; for (const view of views.values()) view.dispose(); views.clear(); composer.clear(); } };
}
