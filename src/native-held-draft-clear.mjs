export function clearDraftText(editor) {
  if (!(editor instanceof HTMLElement) || !editor.isContentEditable) return false;
  const selection = window.getSelection();
  if (!selection) return false;
  editor.focus({ preventScroll: true });
  const range = document.createRange();
  range.selectNodeContents(editor);
  selection.removeAllRanges();
  selection.addRange(range);
  const selectionIsInsideEditor = selection.rangeCount === 1
    && editor.contains(selection.anchorNode)
    && editor.contains(selection.focusNode)
    && editor.contains(selection.getRangeAt(0).commonAncestorContainer);
  if (!selectionIsInsideEditor) { selection.removeAllRanges(); return false; }
  document.execCommand('delete', false, null);
  selection.removeAllRanges();
  return !draftText(editor);
}
