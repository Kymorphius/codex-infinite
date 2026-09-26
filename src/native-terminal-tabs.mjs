// Terminal conversations are provider-owned pages, never native Codex routes.
export function terminalConversationTab(record) {
  if (record?.provider !== 'terminal' || !/^[0-9a-f-]{36}$/i.test(record?.id || '') || !record.deviceId) return null;
  return { kind: 'terminal', id: record.id, deviceId: record.deviceId, title: record.title, cwd: record.cwd, engine: record.kind };
}

export function createNativeTerminalTabController({ state, keyFor, normalizeTab, open, close, render }) {
  return {
    openTerminal: tab => open({ ...tab, kind: 'terminal' }),
    syncTerminal(records) {
      let changed = false;
      for (const record of records || []) {
        const tab = normalizeTab(terminalConversationTab(record));
        if (!tab) continue;
        const key = keyFor(tab), index = state.tabs.findIndex(value => keyFor(value) === key);
        if (index < 0) continue;
        if (record.archived) { close(key); continue; }
        if (JSON.stringify(tab) !== JSON.stringify(state.tabs[index])) { state.tabs[index] = tab; changed = true; }
      }
      if (changed) render();
    }
  };
}

export function buildNativeTerminalTabSource() {
  return [terminalConversationTab, createNativeTerminalTabController].map(fn => fn.toString()).join('\n');
}
