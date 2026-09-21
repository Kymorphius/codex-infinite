export function restoreNativeHeldDraft(threadId, draftKey) {
  const id = threadId(); if (!id) return;
  let saved; try { saved = JSON.parse(localStorage.getItem(draftKey) || 'null'); } catch {}
  if (!saved || saved.threadId !== id || Date.now() - saved.savedAt > 300000) return;
  const editor = document.querySelector('[data-codex-composer="true"][contenteditable="true"]');
  if (!editor || (editor.innerText || editor.textContent || '').trim()) return;
  editor.focus(); document.execCommand('insertText', false, String(saved.text || '')); localStorage.removeItem(draftKey);
}

export function reloadWithHeldDraft(threadId, draftText, draftKey) {
  const id = threadId(), editor = document.querySelector('[data-codex-composer="true"][contenteditable="true"]');
  const text = draftText(editor);
  if (id && text) localStorage.setItem(draftKey, JSON.stringify({ threadId: id, text, savedAt: Date.now() }));
  location.reload();
}
