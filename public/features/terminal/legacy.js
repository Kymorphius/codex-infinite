import { requestJson } from "../../core/transport.js";
import { createTerminalSession } from "./session.js";
import { createTerminalComposer, isAbsoluteTerminalDirectory, normalizeTerminalReference, readSelectedTerminal, resolveTerminalSelection, saveSelectedTerminal, shouldSubmitTerminalDraft, terminalDirectories, terminalMessage, terminalReferenceSessions, terminalStatus, terminalTabTitle } from "./presentation.js";

export function createLegacyTerminalFeature({ state, $, showToast }) {
  const panel = $('[data-module-panel="terminal"]');
  const tabs = $('[data-testid="terminal-tabs"]');
  const viewport = $('[data-testid="terminal-viewport"]');
  const directory = $('[data-testid="terminal-cwd"]');
  const alert = $('[data-testid="terminal-error"]');
  const empty = $('[data-testid="terminal-empty"]');
  const bar = $('[data-testid="terminal-session-bar"]');
  const reconnect = $('[data-terminal-reconnect]');
  const closeButton = $('[data-terminal-close]');
  const dialog = $('[data-testid="terminal-close-dialog"]');
  const composerForm = $('[data-testid="terminal-composer"]');
  const input = $('[data-testid="terminal-composer-input"]');
  const launcher = $('[data-terminal-launcher]');
  const views = new Map();
  let storage;
  try { storage = globalThis.sessionStorage; } catch { /* Storage can be disabled by the browser. */ }
  let sessions = [];
  let selectedId = readSelectedTerminal(storage);
  let pendingClose = "";
  let active = false;
  let bound = false;
  let loading = false;
  let busy = false;
  let disposed = false;
  let loadGeneration = 0;
  let defaultCwd = "";
  let composing = false;
  let reference = { provider: "terminal", cwd: "", projectName: "" };
  let requestedId = "";
  let referenceError = "";
  let referenceRevision = 0;
  let reloadQueued = false;
  const listedSessions = () => terminalReferenceSessions(sessions, reference);
  const composer = createTerminalComposer({ getView: (id) => views.get(id), onChange: renderComposer });

  const post = (action, body) => requestJson(`/api/terminal/${action}`, { method: "POST", body });
  function setError(message = "") { alert.textContent = message; alert.classList.toggle("hidden", !message); }
  function setBusy(value) {
    busy = value;
    for (const button of panel.querySelectorAll("[data-terminal-create], [data-terminal-close-confirm]")) button.disabled = value;
    closeButton.disabled = value;
    renderComposer();
  }
  function renderComposer() {
    const selected = sessions.find((session) => session.id === selectedId);
    const current = composer.snapshot();
    composerForm.classList.toggle("hidden", !selected);
    if (input.value !== current.draft) input.value = current.draft;
    input.placeholder = selected?.kind === "claude" ? "输入消息或 /命令…" : "输入命令…";
    input.style.height = "auto";
    input.style.height = `${Math.min(112, Math.max(58, input.scrollHeight))}px`;
    for (const button of composerForm.querySelectorAll("[data-terminal-send], [data-terminal-paste]")) button.disabled = busy || !current.canSend || !current.draft.trim();
    for (const button of composerForm.querySelectorAll("[data-terminal-key]")) button.disabled = busy || !current.canSend;
    for (const key of ["interrupt", "escape"]) $('[data-terminal-key="' + key + '"]').disabled = busy || !current.canInput;
    $('[data-terminal-send]').dataset.sending = String(current.sending);
    $('[data-terminal-send]').setAttribute("aria-busy", String(current.sending));
    $('[data-testid="terminal-session-kind"]').textContent = selected?.kind === "claude" ? "Claude CLI" : "Shell";
    $('[data-terminal-same-directory]').disabled = busy || !selected;
    $('[data-terminal-focus]').disabled = !selected;
    $('[data-testid="terminal-composer-hint"]').textContent = current.sending ? "正在交给终端…" : !current.canInput ? "终端未就绪，仍可编辑草稿" : "Enter 发送 · Shift+Enter 换行";
  }
  function updateDirectories() {
    $('[id="terminal-project-directories"]').replaceChildren(...terminalDirectories(state, defaultCwd).map((cwd) => {
      const option = document.createElement("option"); option.value = cwd; return option;
    }));
  }
  function render() {
    const selected = sessions.find((session) => session.id === selectedId);
    const snapshot = views.get(selectedId)?.snapshot();
    panel.querySelector('.terminal-heading h2').textContent = reference.projectName || (reference.cwd ? reference.cwd.split(/[\\/]/u).filter(Boolean).at(-1) || reference.cwd : "会话");
    $('[data-terminal-all]').classList.toggle('hidden', !reference.cwd);
    tabs.replaceChildren(...listedSessions().map((session) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "terminal-tab";
      button.dataset.terminalId = session.id;
      button.dataset.exited = String(session.status === "exited");
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(session.id === selectedId));
      button.setAttribute("aria-controls", `terminal-screen-${session.id}`);
      button.id = `terminal-tab-${session.id}`;
      button.tabIndex = session.id === selectedId ? 0 : -1;
      button.textContent = terminalTabTitle(session, sessions);
      button.title = session.cwd;
      return button;
    }));
    empty.classList.toggle("hidden", Boolean(selected));
    viewport.classList.toggle("hidden", !selected);
    bar.classList.toggle("hidden", !selected);
    $('[data-testid="terminal-session-title"]').textContent = selected ? terminalTabTitle(selected, sessions) : "终端会话";
    $('[data-testid="terminal-status"]').textContent = selected ? terminalStatus(snapshot?.session || selected, snapshot?.connection) : "";
    $('[data-testid="terminal-path"]').textContent = selected?.cwd || "";
    $('[data-testid="terminal-path"]').title = selected?.cwd || "";
    $('[data-testid="terminal-replay-note"]').classList.toggle("hidden", !snapshot?.session.replayTruncated);
    reconnect.classList.toggle("hidden", !selected || selected.status === "exited" || !["takenover", "disconnected", "error"].includes(snapshot?.connection));
    closeButton.disabled = busy || !selected;
    if (snapshot?.error) setError(snapshot.error);
    renderComposer();
  }
  function select(id) {
    selectedId = id;
    if (id) requestedId = '';
    composing = false;
    composer.select(id);
    saveSelectedTerminal(storage, id);
    const route = new URL(location.href);
    for (const key of ['session', 'cwd', 'projectName']) route.searchParams.delete(key);
    route.searchParams.set('module', 'terminal');
    if (id || requestedId) route.searchParams.set('session', id || requestedId);
    if (reference.cwd) route.searchParams.set('cwd', reference.cwd);
    if (reference.projectName) route.searchParams.set('projectName', reference.projectName);
    if (state.module === 'terminal') history.replaceState(null, '', route);
    for (const [viewId, view] of views) if (viewId !== id) view.deactivate();
    setError();
    render();
    const session = sessions.find((item) => item.id === id);
    if (!session || !active) return;
    if (!globalThis.Terminal || !globalThis.FitAddon?.FitAddon) {
      setError("终端界面未能加载，请刷新页面后重试。");
      return;
    }
    if (!views.has(id)) {
      const host = document.createElement("div");
      host.className = "terminal-screen";
      host.id = `terminal-screen-${id}`;
      host.setAttribute("role", "tabpanel");
      host.setAttribute("aria-labelledby", `terminal-tab-${id}`);
      viewport.append(host);
      const view = createTerminalSession(session, { host, onChange(snapshot) {
        sessions = sessions.map((item) => item.id === id ? snapshot.session : item);
        if (selectedId === id) { setError(snapshot.error); render(); }
      } });
      views.set(id, view);
    }
    views.get(id).activate();
    render();
  }
  async function load() {
    active = true;
    if (disposed) return;
    if (referenceError) { setError(referenceError); return; }
    if (selectedId) select(selectedId);
    updateDirectories();
    if (loading) return;
    loading = true;
    const generation = ++loadGeneration;
    const revision = referenceRevision;
    $('[data-testid="terminal-empty-message"]').textContent = "正在读取本机终端…";
    try {
      const result = await post("list", {});
      if (disposed || generation !== loadGeneration || revision !== referenceRevision) return;
      sessions = result.sessions;
      defaultCwd = result.defaultCwd || "";
      if (!directory.value) directory.value = defaultCwd;
      updateDirectories();
      for (const [id, view] of views) {
        const session = sessions.find((item) => item.id === id);
        if (session) view.update(session);
        else { view.dispose(); views.delete(id); }
      }
      const selection = resolveTerminalSelection(sessions, { ...reference, sessionId: requestedId }, selectedId);
      select(selection.id);
      if (selection.error) setError(selection.error);
      if (!selection.id && reference.cwd) launcher.open = true;
    } catch (error) {
      if (!disposed && revision === referenceRevision) setError(terminalMessage(error, "暂时无法读取本机终端，请稍后刷新会话。"));
    } finally {
      loading = false;
      $('[data-testid="terminal-empty-message"]').textContent = reference.cwd ? "当前项目还没有终端会话。新建会话会使用此项目目录。" : "从右上角新建会话，打开终端或原生 Claude CLI。";
      if (reloadQueued) { reloadQueued = false; if (!disposed && active && !referenceError) void load(); }
    }
  }
  async function create(kind, selectedDirectory) {
    if (busy) return;
    if (!globalThis.Terminal || !globalThis.FitAddon?.FitAddon) { setError("终端界面未能加载，请刷新页面后重试。"); return; }
    const cwd = selectedDirectory ?? directory.value.trim();
    if (!isAbsoluteTerminalDirectory(cwd)) { setError("请填写完整的工作目录路径。"); directory.focus(); return; }
    setError();
    setBusy(true);
    try {
      const { session } = await post("create", { cwd, kind, cols: 100, rows: 30 });
      ++loadGeneration;
      if (disposed) return;
      sessions = [...sessions.filter((item) => item.id !== session.id), session];
      referenceError = "";
      if (reference.cwd && reference.cwd !== session.cwd) reference = { provider: 'terminal', cwd: session.cwd, projectName: '' };
      launcher.open = false;
      select(session.id);
    } catch (error) { setError(terminalMessage(error, "终端未能启动，请检查工作目录后重试。")); }
    finally { setBusy(false); }
  }
  async function close(id) {
    if (busy || !id) return;
    setBusy(true);
    try {
      await post("close", { id });
      ++loadGeneration;
      views.get(id)?.dispose();
      views.delete(id);
      composer.forget(id);
      sessions = sessions.filter((item) => item.id !== id);
      dialog.close();
      pendingClose = "";
      select(selectedId === id ? listedSessions().at(-1)?.id || "" : selectedId);
      showToast("终端已关闭");
    } catch (error) {
      dialog.close();
      pendingClose = "";
      setError(terminalMessage(error, "未能关闭终端，请重新连接后重试。"));
    } finally { setBusy(false); }
  }
  async function sendDraft(submit) {
    const id = selectedId;
    setError();
    const result = await composer.send({ submit });
    if (id !== selectedId || disposed) return;
    if (!result.ok) setError(result.message || "未能发送到终端，草稿已保留。");
    else if (!submit) { showToast("已粘贴到终端，尚未发送 Enter"); views.get(id)?.focus(); }
    else input.focus();
  }
  function openReference(value) {
    ++referenceRevision;
    let next;
    try { next = normalizeTerminalReference(value, state.devices?.find(device => device.kind === 'local-codex')?.id); }
    catch (error) { referenceError = error.message; selectedId = ''; for (const view of views.values()) view.deactivate(); render(); setError(referenceError); return false; }
    reference = next; referenceError = '';
    requestedId = reference.sessionId;
    selectedId = "";
    if (reference.cwd) directory.value = reference.cwd;
    for (const view of views.values()) view.deactivate();
    render();
    if (loading) reloadQueued = true;
    else void load();
    return true;
  }
  function bind() {
    if (bound) return;
    bound = true;
    for (const button of panel.querySelectorAll("[data-terminal-create]")) button.addEventListener("click", () => void create(button.dataset.terminalCreate));
    $('[data-terminal-same-directory]').addEventListener("click", () => {
      const selected = sessions.find((session) => session.id === selectedId);
      $('[data-terminal-keys]').open = false;
      if (selected) void create("shell", selected.cwd);
    });
    tabs.addEventListener("click", (event) => { const button = event.target.closest("[data-terminal-id]"); if (button) select(button.dataset.terminalId); });
    tabs.addEventListener("keydown", (event) => {
      const choices = listedSessions();
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key) || !choices.length) return;
      event.preventDefault();
      const current = choices.findIndex((item) => item.id === selectedId);
      const index = event.key === "Home" ? 0 : event.key === "End" ? choices.length - 1 : (current + (["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1) + choices.length) % choices.length;
      select(choices[index].id);
      tabs.querySelector('[aria-selected="true"]')?.focus();
    });
    closeButton.addEventListener("click", () => {
      const session = sessions.find((item) => item.id === selectedId);
      if (!session) return;
      if (session.status === "exited") { void close(session.id); return; }
      pendingClose = session.id;
      $('[data-testid="terminal-close-name"]').textContent = `${terminalTabTitle(session, sessions)} · ${session.cwd}`;
      dialog.showModal();
      $('[data-terminal-close-cancel]').focus();
    });
    $('[data-terminal-close-cancel]').addEventListener("click", () => { dialog.close(); pendingClose = ""; });
    $('[data-terminal-close-confirm]').addEventListener("click", () => void close(pendingClose));
    dialog.addEventListener("cancel", () => { pendingClose = ""; });
    reconnect.addEventListener("click", () => { setError(); views.get(selectedId)?.reconnect(); });
    $('[data-terminal-refresh]').addEventListener("click", () => void load());
    directory.addEventListener("focus", updateDirectories);
    $('[data-terminal-all]').addEventListener('click', () => openReference({ provider: 'terminal' }));
    input.addEventListener("input", () => composer.setDraft(input.value));
    input.addEventListener("compositionstart", () => { composing = true; });
    input.addEventListener("compositionend", () => { composing = false; composer.setDraft(input.value); });
    input.addEventListener("keydown", (event) => {
      if (!shouldSubmitTerminalDraft(event, composing)) return;
      event.preventDefault();
      void sendDraft(true);
    });
    composerForm.addEventListener("submit", (event) => { event.preventDefault(); if (!composing) void sendDraft(true); });
    $('[data-terminal-paste]').addEventListener("click", () => { if (!composing) void sendDraft(false); });
    $('[data-terminal-focus]').addEventListener("click", () => views.get(selectedId)?.focus());
    for (const button of composerForm.querySelectorAll("[data-terminal-key]")) button.addEventListener("click", () => {
      const result = views.get(selectedId)?.sendKey(button.dataset.terminalKey);
      if (result && !result.ok) setError(result.message || "终端当前无法接收按键。");
      else { setError(); views.get(selectedId)?.focus(); }
      $('[data-terminal-keys]').open = false;
    });
    const params = new URLSearchParams(location.search);
    if (state.module === 'terminal' && (params.has('session') || params.has('cwd'))) openReference({ provider: 'terminal', sessionId: params.get('session') || '', cwd: params.get('cwd') || '', projectName: params.get('projectName') || '' });
  }
  return {
    bind, load, openReference,
    deactivate() { active = false; for (const view of views.values()) view.deactivate(); dialog.close(); pendingClose = ""; },
    dispose() { disposed = true; ++loadGeneration; for (const view of views.values()) view.dispose(); views.clear(); composer.clear(); }
  };
}
