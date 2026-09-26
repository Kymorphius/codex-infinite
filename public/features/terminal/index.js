import { requestJson } from "../../core/transport.js";
import { createTerminalSession } from "./session.js";
import { isAbsoluteTerminalDirectory, readSelectedTerminal, saveSelectedTerminal, selectListedTerminal, terminalDirectories, terminalMessage, terminalStatus, terminalTabTitle } from "./presentation.js";

export function createTerminalFeature({ state, $, showToast }) {
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

  const post = (action, body) => requestJson(`/api/terminal/${action}`, { method: "POST", body });
  function setError(message = "") { alert.textContent = message; alert.classList.toggle("hidden", !message); }
  function setBusy(value) {
    busy = value;
    for (const button of panel.querySelectorAll("[data-terminal-create], [data-terminal-close-confirm]")) button.disabled = value;
    closeButton.disabled = value;
  }
  function updateDirectories() {
    $('[id="terminal-project-directories"]').replaceChildren(...terminalDirectories(state, defaultCwd).map((cwd) => {
      const option = document.createElement("option"); option.value = cwd; return option;
    }));
  }
  function render() {
    const selected = sessions.find((session) => session.id === selectedId);
    const snapshot = views.get(selectedId)?.snapshot();
    tabs.replaceChildren(...sessions.map((session) => {
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
    $('[data-testid="terminal-status"]').textContent = selected ? terminalStatus(snapshot?.session || selected, snapshot?.connection) : "";
    $('[data-testid="terminal-path"]').textContent = selected?.cwd || "";
    $('[data-testid="terminal-path"]').title = selected?.cwd || "";
    $('[data-testid="terminal-replay-note"]').classList.toggle("hidden", !snapshot?.session.replayTruncated);
    reconnect.classList.toggle("hidden", !selected || selected.status === "exited" || !["takenover", "disconnected", "error"].includes(snapshot?.connection));
    closeButton.disabled = busy || !selected;
    if (snapshot?.error) setError(snapshot.error);
  }
  function select(id) {
    selectedId = id;
    saveSelectedTerminal(storage, id);
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
    if (selectedId) select(selectedId);
    updateDirectories();
    if (loading) return;
    loading = true;
    const generation = ++loadGeneration;
    $('[data-testid="terminal-empty-message"]').textContent = "正在读取本机终端…";
    try {
      const result = await post("list", {});
      if (disposed || generation !== loadGeneration) return;
      sessions = result.sessions;
      defaultCwd = result.defaultCwd || "";
      if (!directory.value) directory.value = defaultCwd;
      updateDirectories();
      for (const [id, view] of views) {
        const session = sessions.find((item) => item.id === id);
        if (session) view.update(session);
        else { view.dispose(); views.delete(id); }
      }
      select(selectListedTerminal(sessions, selectedId));
    } catch (error) {
      setError(terminalMessage(error, "暂时无法读取本机终端，请稍后刷新会话。"));
    } finally {
      loading = false;
      $('[data-testid="terminal-empty-message"]').textContent = "选择工作目录，打开终端或原生 Claude CLI。";
    }
  }
  async function create(kind) {
    if (busy) return;
    if (!globalThis.Terminal || !globalThis.FitAddon?.FitAddon) { setError("终端界面未能加载，请刷新页面后重试。"); return; }
    const cwd = directory.value.trim();
    if (!isAbsoluteTerminalDirectory(cwd)) { setError("请填写完整的工作目录路径。"); directory.focus(); return; }
    setError();
    setBusy(true);
    try {
      const { session } = await post("create", { cwd, kind, cols: 100, rows: 30 });
      ++loadGeneration;
      if (disposed) return;
      sessions = [...sessions.filter((item) => item.id !== session.id), session];
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
      sessions = sessions.filter((item) => item.id !== id);
      dialog.close();
      pendingClose = "";
      select(selectedId === id ? sessions.at(-1)?.id || "" : selectedId);
      showToast("终端已关闭");
    } catch (error) {
      dialog.close();
      pendingClose = "";
      setError(terminalMessage(error, "未能关闭终端，请重新连接后重试。"));
    } finally { setBusy(false); }
  }
  function bind() {
    if (bound) return;
    bound = true;
    for (const button of panel.querySelectorAll("[data-terminal-create]")) button.addEventListener("click", () => void create(button.dataset.terminalCreate));
    tabs.addEventListener("click", (event) => { const button = event.target.closest("[data-terminal-id]"); if (button) select(button.dataset.terminalId); });
    tabs.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || !sessions.length) return;
      event.preventDefault();
      const current = sessions.findIndex((item) => item.id === selectedId);
      const index = event.key === "Home" ? 0 : event.key === "End" ? sessions.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + sessions.length) % sessions.length;
      select(sessions[index].id);
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
  }
  return {
    bind, load,
    deactivate() { active = false; for (const view of views.values()) view.deactivate(); dialog.close(); pendingClose = ""; },
    dispose() { disposed = true; ++loadGeneration; for (const view of views.values()) view.dispose(); views.clear(); }
  };
}
