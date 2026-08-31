export function presentConversationEntry(entry) {
  const identity = entry.id ? { id: String(entry.id) } : {};
  if (entry.kind === "message") {
    const role = entry.role === "user" ? "user" : "assistant";
    return Object.freeze({
      ...identity,
      kind: "message",
      role,
      label: role === "user" ? "你" : entry.phase === "commentary" ? "Codex · 进行中" : "Codex",
      text: entry.text || "",
      timestamp: entry.timestamp || null
    });
  }
  if (entry.kind === "tool") {
    const name = entry.name || "工具";
    const status = entry.status || "已请求";
    return Object.freeze({
      ...identity,
      kind: "tool",
      role: "system",
      label: "执行过程",
      text: `${name} · ${status}`,
      name,
      status,
      callId: entry.callId || null,
      input: typeof entry.input === "string" ? entry.input : null,
      output: typeof entry.output === "string" ? entry.output : null,
      inputTruncated: Boolean(entry.inputTruncated),
      outputTruncated: Boolean(entry.outputTruncated),
      timestamp: entry.timestamp || null
    });
  }
  const statusText = entry.status === "completed" ? "本轮已完成" : entry.status === "interrupted" ? "本轮已中断" : "本轮已开始";
  return Object.freeze({
    ...identity,
    kind: "status",
    role: "system",
    label: "会话状态",
    text: statusText,
    timestamp: entry.timestamp || null
  });
}

function visibleMessageText(entry) {
  const text = String(entry.text || "");
  if (entry.role !== "user") return text;
  return text
    .replace(/<recommended_plugins>[\s\S]*?<\/recommended_plugins>/g, "")
    .replace(/<environment_context>[\s\S]*?<\/environment_context>/g, "")
    .trim();
}

export function presentConversationEntries(entries) {
  const presented = [];
  for (const rawEntry of entries) {
    const cleaned = rawEntry.kind === "message" ? { ...rawEntry, text: visibleMessageText(rawEntry) } : rawEntry;
    if (cleaned.kind === "message" && !cleaned.text) continue;
    const entry = presentConversationEntry(cleaned);
    presented.push(entry);
  }
  return Object.freeze(presented);
}

export function conversationEntryKey(entry, index = 0) {
  return `${entry?.kind || "entry"}:${entry?.id || index}`;
}

export function conversationEntrySignature(entry) {
  return JSON.stringify([
    entry?.kind,
    entry?.role,
    entry?.label,
    entry?.text,
    entry?.timestamp,
    entry?.callId,
    entry?.input,
    entry?.output,
    Boolean(entry?.inputTruncated),
    Boolean(entry?.outputTruncated)
  ]);
}

export function conversationTurnPresentation(state) {
  return Object.freeze({
    active: { label: "进行中", tone: "active" },
    completed: { label: "已完成", tone: "completed" },
    interrupted: { label: "已中断", tone: "interrupted" },
    unknown: { label: "状态同步中", tone: "unknown" }
  }[state] || { label: "状态同步中", tone: "unknown" });
}

export function shouldFollowConversationLatest({ quiet, scrollHeight, scrollTop, clientHeight }, threshold = 80) {
  if (!quiet) return true;
  return Number(scrollHeight) - Number(scrollTop) - Number(clientHeight) <= threshold;
}
