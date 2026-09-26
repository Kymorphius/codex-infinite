export function terminalStatus(session, connection = "") {
  if (session?.status === "exited") return `已退出${Number.isInteger(session.exitCode) ? ` · 退出码 ${session.exitCode}` : ""}`;
  return ({ connected: "已连接", connecting: "正在连接…", retrying: "连接中断，正在重连…", disconnected: "连接已断开", takenover: "已由另一个页面接管", error: "连接失败", closed: "终端已关闭" })[connection] || "未连接";
}

export function terminalMessage(error, fallback) {
  const message = typeof error?.message === "string" ? error.message : "";
  return /[\u4e00-\u9fff]/u.test(message) ? message.slice(0, 300) : fallback;
}

export function terminalDirectories(state, defaultCwd = "") {
  return [...new Set([defaultCwd, ...(state.projects || []).map((item) => item.cwd || item.path), ...(state.tasks || []).filter((task) => !task.device || task.device.kind === "local-codex").map((item) => item.cwd)].filter(isAbsoluteTerminalDirectory))].sort();
}

export function isAbsoluteTerminalDirectory(path) {
  return typeof path === "string" && (/^\//u.test(path) || /^[A-Za-z]:[\\/]/u.test(path) || /^\\\\[^\\]+\\[^\\]+/u.test(path));
}

const selectedSessionKey = "codex-control-console.terminal.selected.v1";

export function readSelectedTerminal(storage) {
  try { return storage.getItem(selectedSessionKey) || ""; } catch { return ""; }
}

export function saveSelectedTerminal(storage, id) {
  try {
    if (id) storage.setItem(selectedSessionKey, id);
    else storage.removeItem(selectedSessionKey);
  } catch { /* Session selection is optional when browser storage is unavailable. */ }
}

export function selectListedTerminal(sessions, preferredId) {
  return sessions.find((session) => session.id === preferredId)?.id || sessions.find((session) => session.status === "running")?.id || sessions[0]?.id || "";
}

export function terminalTabTitle(session, sessions) {
  const titleOf = (item) => item.title || (item.kind === "claude" ? "Claude CLI" : "终端");
  const title = titleOf(session);
  const duplicates = sessions.filter((item) => titleOf(item) === title);
  return duplicates.length > 1 ? `${title} ${duplicates.findIndex((item) => item.id === session.id) + 1}` : title;
}

export function shouldSubmitTerminalDraft(event, composing = false) {
  return event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && !event.isComposing && event.keyCode !== 229 && !composing;
}

export function createTerminalComposer({ getView, onChange = () => {}, storage, storageKey = id => `terminal-draft:${id}` }) {
  const drafts = new Map();
  const revisions = new Map();
  const pending = new Set();
  let selectedId = "";
  const draft = () => drafts.get(selectedId) || "";
  function persist(id, value) {
    try { if (value) storage?.setItem(storageKey(id), value); else storage?.removeItem(storageKey(id)); } catch { /* Drafts remain available in memory. */ }
  }
  return {
    draft,
    select(id) { selectedId = id; if (id && !drafts.has(id)) { try { drafts.set(id, storage?.getItem(storageKey(id)) || ''); } catch { /* Storage is optional. */ } } onChange(); },
    setDraft(text) { if (selectedId) { drafts.set(selectedId, text); persist(selectedId, text); revisions.set(selectedId, (revisions.get(selectedId) || 0) + 1); } onChange(); },
    forget(id) { drafts.delete(id); revisions.delete(id); persist(id, ''); },
    clear() { drafts.clear(); revisions.clear(); },
    snapshot() {
      const state = getView(selectedId)?.snapshot();
      const sending = pending.has(selectedId) || Boolean(state?.sending);
      const canInput = Boolean(state?.canInput);
      return { draft: draft(), sending, canInput, canSend: canInput && !sending };
    },
    async send({ submit = true } = {}) {
      const id = selectedId;
      const text = draft();
      const revision = revisions.get(id);
      const view = getView(id);
      if (!id || !text.trim()) return { ok: false, message: "请先输入内容。" };
      if (pending.has(id) || !view?.snapshot().canInput || view.snapshot().sending) return { ok: false, message: "终端当前无法接收输入，草稿已保留。" };
      pending.add(id);
      onChange();
      try {
        const result = await view.pasteText(text, { submit });
        if (result.ok && drafts.get(id) === text && revisions.get(id) === revision) { drafts.delete(id); persist(id, ''); }
        return result;
      } catch (error) {
        return { ok: false, message: terminalMessage(error, "未能发送到终端，草稿已保留。请查看终端后重试。") };
      } finally { pending.delete(id); onChange(); }
    }
  };
}

export function normalizeTerminalReference(value, localDeviceId) {
  if (!value || value.provider !== "terminal" || value.deviceId && value.deviceId !== localDeviceId) throw Error("此入口只支持本机终端会话。");
  const { sessionId = "", cwd = "", projectName = "" } = value;
  if (typeof sessionId !== "string" || sessionId && !/^[a-zA-Z0-9_-]{1,80}$/u.test(sessionId)) throw Error("终端会话标识无效。");
  if (typeof cwd !== "string" || cwd && (!isAbsoluteTerminalDirectory(cwd) || cwd.length > 4096 || /[\u0000-\u001f\u007f]/u.test(cwd))) throw Error("项目工作目录无效。");
  if (typeof projectName !== "string") throw Error("项目名称无效。");
  return { provider: "terminal", sessionId, cwd, projectName: projectName.replace(/[\u0000-\u001f\u007f]/gu, "").trim().slice(0, 160) };
}

export function terminalReferenceSessions(sessions, reference) {
  return reference.cwd ? sessions.filter(session => session.cwd === reference.cwd) : sessions;
}

export function resolveTerminalSelection(sessions, reference, preferredId) {
  const scoped = terminalReferenceSessions(sessions, reference);
  if (reference.sessionId && !scoped.some(session => session.id === reference.sessionId)) return { id: "", error: "该终端会话已关闭，或不属于当前项目。" };
  return { id: reference.sessionId || selectListedTerminal(scoped, preferredId), error: "" };
}
