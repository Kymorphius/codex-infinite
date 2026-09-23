export function normalizeRecentSentSnapshot(input) {
  const items = [], seen = new Set();
  const candidates = (Array.isArray(input?.items) ? input.items : []).slice(0, 160)
    .filter((item) => item?.kind === "local" && typeof item.id === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(item.id) && typeof item.lastUserMessageAt === "string" && Number.isFinite(Date.parse(item.lastUserMessageAt)))
    .sort((a, b) => Date.parse(b.lastUserMessageAt) - Date.parse(a.lastUserMessageAt) || String(a.id).localeCompare(String(b.id)));
  for (const item of candidates) {
    const id = item.id.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    items.push({ kind: "local", id, title: String(item.title || "Codex 会话").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 160), lastUserMessageAt: new Date(item.lastUserMessageAt).toISOString() });
    if (items.length === 40) break;
  }
  return { items, loading: input?.loading === true, stale: input?.stale === true };
}

export function installNativeRecentSentMenu({ documentRef, root, state, keyFor, openLocal, openWindow, readSnapshot }) {
  const menu = installNativeRecentConversationMenu({
    documentRef, root, state, keyFor, openWindow,
    label: "最近发送", icon: "↑", hint: "本机 Codex 会话，按你最近发送消息的时间排序",
    readRecords: () => readSnapshot()?.items || [],
    readStatus: () => {
      const snapshot = readSnapshot();
      if (!snapshot || snapshot.loading) return "正在索引发送时间…";
      return snapshot.stale ? "部分发送时间暂未刷新，保留已知记录" : "";
    },
    emptyText: "暂无发过消息的本机会话",
    detailFor: (tab) => "发送于 " + new Date(tab.lastUserMessageAt).toLocaleString("zh-CN", { hour12: false }),
    onSelect: (tab) => openLocal(tab)
  });
  return menu;
}

export function buildNativeRecentSentMenuInjectionSource() {
  return installNativeRecentSentMenu.toString();
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
