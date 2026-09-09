// Verify the identity attached to the visible composer itself. A thread need
// not appear in the current (collapsed or paginated) sidebar to be open.
export function readNativeComposerState(document, threadId) {
  const editor = document.querySelector('[data-codex-composer="true"][contenteditable="true"]');
  if (!editor || !(editor.offsetWidth || editor.offsetHeight)) return { ready: false };
  let root = editor.parentElement;
  while (root) {
    const portal = root.querySelector('[data-above-composer-conversation-id]');
    if (portal) {
      if (portal.getAttribute('data-above-composer-conversation-id') !== threadId) return { ready: false };
      return { ready: true, draft: (editor.innerText || editor.textContent || '').trim() };
    }
    root = root.parentElement;
  }
  const selected = document.querySelector(`[data-app-action-sidebar-thread-id="local:${threadId}"][data-app-action-sidebar-thread-selected="true"]`);
  return selected ? { ready: true, draft: (editor.innerText || editor.textContent || '').trim() } : { ready: false };
}
export const nativeComposerStateExpression = threadId => `(${readNativeComposerState.toString()})(document,${JSON.stringify(threadId)})`;
