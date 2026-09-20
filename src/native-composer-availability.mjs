export function noThread(kind) {
  return kind === 'held'
    ? `if (!id) { document.querySelectorAll('[data-ccc-held-queue-button],[data-ccc-save-draft-todo],[data-ccc-held-queue-panel]').forEach(node => node.remove()); claimTasks.ensure(host, null); return; }`
    : `if (!id) { document.querySelector('[data-ccc-save-draft-todo]')?.remove(); claimTasks.ensure(host, null); return; }`;
}
