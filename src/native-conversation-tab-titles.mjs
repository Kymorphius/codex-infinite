export function preferNativeConversationTitle(incoming, previous = "", fallback = "未命名会话") {
  const clean = value => String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, 160);
  const placeholder = value => /^(?:未命名(?:会话|对话)|untitled(?: conversation| chat)?)$/i.test(value);
  const next = clean(incoming), known = clean(previous);
  if (next && !placeholder(next)) return next;
  if (known && !placeholder(known)) return known;
  return next || clean(fallback) || "未命名会话";
}

export function createNativeConversationTabTitlePolicy(storage) {
  const key = 'codex-control-console.conversation-titles.v1';
  let titles = {};
  try { const stored = JSON.parse(storage.getItem(key) || '{}'); titles = stored && !Array.isArray(stored) ? stored : {}; } catch {}
  return {
    resolve(kind, id, incoming) {
      const title = preferNativeConversationTitle(incoming, kind === 'local' ? titles[id] : '');
      if (kind !== 'local' || !title || /^(?:未命名(?:会话|对话)|untitled(?: conversation| chat)?)$/i.test(title) || titles[id] === title) return title;
      titles[id] = title; titles = Object.fromEntries(Object.entries(titles).slice(-400));
      try { storage.setItem(key, JSON.stringify(titles)); } catch {}
      return title;
    }
  };
}

export function createNativeConversationTabNormalizer(storage, clean, uuid) {
  const titles = createNativeConversationTabTitlePolicy(storage);
  return tab => {
    const kind = tab?.kind === 'remote' ? 'remote' : tab?.kind === 'local' ? 'local' : tab?.kind === 'chatgpt' ? 'chatgpt' : null;
    const id = clean(tab?.id, 160), deviceId = kind === 'remote' ? clean(tab?.deviceId, 120) : 'local';
    if (!kind || !id || !deviceId || (kind !== 'remote' && !uuid.test(id))) return null;
    const normalizedId = kind === 'remote' ? id : id.toLowerCase();
    return { kind, id: normalizedId, deviceId, title: titles.resolve(kind, normalizedId, clean(tab?.title, 160)), cwd: clean(tab?.cwd, 1024), deviceName: clean(tab?.deviceName, 80) };
  };
}

export function buildNativeConversationTabTitlePolicySource() {
  return `${preferNativeConversationTitle.toString()}\n${createNativeConversationTabTitlePolicy.toString()}\n${createNativeConversationTabNormalizer.toString()}`;
}
