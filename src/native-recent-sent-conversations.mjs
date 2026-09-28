export function normalizeRecentSentSnapshot(input) {
  const items = [], seen = new Set();
  const candidates = (Array.isArray(input?.items) ? input.items : []).slice(0, 160)
    .filter((item) => item?.kind === "local" && typeof item.id === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(item.id) && typeof item.lastUserMessageAt === "string" && Number.isFinite(Date.parse(item.lastUserMessageAt)))
    .sort((a, b) => Date.parse(b.lastUserMessageAt) - Date.parse(a.lastUserMessageAt) || String(a.id).localeCompare(String(b.id)));
  for (const item of candidates) {
    const id = item.id.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    const status = ["active", "completed", "pending", "interrupted", "error"].includes(item.status) ? item.status : "unknown";
    const quotaResetsAt = typeof item.quotaResetsAt === "string" && Number.isFinite(Date.parse(item.quotaResetsAt)) ? new Date(item.quotaResetsAt).toISOString() : null;
    items.push({ kind: "local", id, title: String(item.title || "Codex 会话").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 160), lastUserMessageAt: new Date(item.lastUserMessageAt).toISOString(), status, ...(quotaResetsAt ? { quotaResetsAt } : {}) });
    if (items.length === 40) break;
  }
  return { items, loading: input?.loading === true, stale: input?.stale === true };
}

// Claude CLI conversations join native ones by the time of your latest message there.
export function mergeRecentSentRecords(nativeItems = [], terminalRecords = [], limit = 40) {
  const terminal = (Array.isArray(terminalRecords) ? terminalRecords : [])
    .filter((record) => record?.provider === "terminal" && record.kind === "claude" && !record.archived && record.deviceId
      && /^[0-9a-f-]{36}$/i.test(record.id || "") && Number.isFinite(Date.parse(record.lastUserMessageAt)))
    .map((record) => ({ kind: "terminal", id: record.id, deviceId: record.deviceId, title: record.title, cwd: record.cwd, engine: record.kind, lastUserMessageAt: record.lastUserMessageAt }));
  return [...(Array.isArray(nativeItems) ? nativeItems : []), ...terminal]
    .sort((a, b) => Date.parse(b.lastUserMessageAt) - Date.parse(a.lastUserMessageAt)).slice(0, limit);
}

export function installNativeRecentSentMenu({ documentRef, root, state, keyFor, openLocal, openTerminal, openWindow, readSnapshot, readTerminal = () => [] }) {
  const menu = installNativeRecentConversationMenu({
    documentRef, root, state, keyFor, openWindow,
    label: "最近发送", icon: "↑", hint: "本机 Codex 与 Claude CLI 会话，按你最近发送消息的时间排序",
    readRecords: () => mergeRecentSentRecords(readSnapshot()?.items || [], readTerminal()),
    readStatus: () => {
      const snapshot = readSnapshot();
      if (!snapshot || snapshot.loading) return "正在索引发送时间…";
      return "";
    },
    emptyText: "暂无发过消息的本机会话",
    detailFor: (tab) => new Date(tab.lastUserMessageAt).toLocaleString("zh-CN", { hour12: false }) + (tab.kind === "terminal" ? " · Claude CLI" : ""),
    onSelect: (tab) => tab.kind === "terminal" ? openTerminal(tab) : openLocal(tab)
  });
  return menu;
}

export function buildNativeRecentSentMenuInjectionSource() {
  return `${mergeRecentSentRecords.toString()}\n${installNativeRecentSentMenu.toString()}`;
}

export function buildNativeRecentSentSnapshotScript(snapshot) {
  if (snapshot === undefined) return "void 0";
  const normalized = normalizeRecentSentSnapshot(snapshot);
  return `(() => {
    const next = ${JSON.stringify(normalized)};
    if (JSON.stringify(window.__codexControlConsoleRecentSentSnapshot) === JSON.stringify(next)) return;
    window.__codexControlConsoleRecentSentSnapshot = next;
    window.__codexControlConsoleConversationTabs?.updateRecentSent?.();
  })()`;
}
