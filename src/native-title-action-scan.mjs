// Only a visible title action justifies measuring every native button.
export function hasVisibleNativeTitleAction(documentRef) {
  const selector = 'button[aria-label="聊天操作"],button[aria-label="Chat actions"]';
  for (const button of documentRef.querySelectorAll(selector)) {
    if (button.closest?.('aside')) continue;
    const rect = button.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && rect.top < 42 && rect.bottom > 0) return true;
  }
  return false;
}
