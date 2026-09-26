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
