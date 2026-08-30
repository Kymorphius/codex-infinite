export async function collectHostEvidence(connection) {
  return connection.evaluate(`(() => {
    const entry = document.querySelector('[data-codex-control-console-entry]');
    const kanbanEntry = document.querySelector('[data-codex-control-console-kanban-entry]');
    const sessionEntry = document.querySelector('[data-codex-control-console-session-entry]');
    const priorityEntry = document.querySelector('[data-codex-control-console-priority-entry]');
    const iframe = document.querySelector('[data-codex-control-console-frame]');
    const workspace = document.querySelector('[data-codex-control-console-workspace]');
    return {
      title: document.title,
      entryVisible: Boolean(entry && entry.getBoundingClientRect().width > 0),
      entryText: entry ? (entry.innerText || entry.textContent || '').trim() : null,
      entryCount: document.querySelectorAll('[data-codex-control-console-entry]').length,
      kanbanEntryVisible: Boolean(kanbanEntry && kanbanEntry.getBoundingClientRect().width > 0),
      kanbanEntryText: kanbanEntry ? (kanbanEntry.innerText || kanbanEntry.textContent || '').trim() : null,
      kanbanEntryCount: document.querySelectorAll('[data-codex-control-console-kanban-entry]').length,
      sessionEntryVisible: Boolean(sessionEntry && sessionEntry.getBoundingClientRect().width > 0),
      sessionEntryText: sessionEntry ? (sessionEntry.innerText || sessionEntry.textContent || '').trim() : null,
      sessionEntryCount: document.querySelectorAll('[data-codex-control-console-session-entry]').length,
      priorityEntryVisible: Boolean(priorityEntry && priorityEntry.getBoundingClientRect().width > 0),
      priorityEntryText: priorityEntry ? (priorityEntry.innerText || priorityEntry.textContent || '').trim() : null,
      priorityEntryCount: document.querySelectorAll('[data-codex-control-console-priority-entry]').length,
      workspaceVisible: Boolean(workspace && workspace.getBoundingClientRect().width > 0),
      dashboardFrameUrl: iframe?.getAttribute('src') || null,
      bodyText: (document.body.innerText || '').slice(0, 1200),
      dashboardFrameReadyState: iframe?.contentDocument?.readyState || null
    };
  })()`);
}
