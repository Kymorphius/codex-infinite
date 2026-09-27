// Native Codex results keep their shape; managed Claude CLI results carry kind 'terminal'.
export function withTerminalSentSearch(base, terminalConversations) {
  return {
    index: base.index,
    prepare: () => base.prepare(),
    async search(query) {
      const [native, terminal] = await Promise.all([
        base.search(query),
        terminalConversations.searchSent(query).catch(() => ({ items: [], incomplete: true }))
      ]);
      const items = [...(native.items || []), ...terminal.items]
        .sort((a, b) => String(b.at || b.updatedAt || '').localeCompare(String(a.at || a.updatedAt || '')));
      return { ...native, items: items.slice(0, 30), incomplete: Boolean(native.incomplete || terminal.incomplete || items.length > 30) };
    }
  };
}
