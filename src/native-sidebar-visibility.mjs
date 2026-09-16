// Explicit UI-only action: reveal the owner's existing sidebar; no membership writes.
export function revealNativeSidebar() {
  const buttons = Array.from(document.querySelectorAll('button'));
  const sidebar = buttons.find(node => /^(显示侧边栏|Show sidebar|Open sidebar)$/.test(node.getAttribute('aria-label') || ''));
  sidebar?.click();
  const activity = buttons.find(node => /^(关闭活动视图|Close activity view)$/.test(node.getAttribute('aria-label') || ''));
  activity?.click();
  return { revealed: true };
}
export function buildNativeSidebarVisibilityScript() { return `(${revealNativeSidebar.toString()})()`; }
