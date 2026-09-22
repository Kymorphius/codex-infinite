// Own an additive top-action entry; native controls and sections remain React-owned.
export function installNativeGeneralChecklist() {
  const VERSION = '2026-09-22.top-action1';
  if (window.__cccGeneralChecklist?.version === VERSION) return;
  window.__cccGeneralChecklist?.dispose();
  const ENTRY = 'data-ccc-general-checklist-entry';
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  const buttonBy = labels => Array.from(document.querySelectorAll('button,[role="button"]')).find(button => {
    const value = normalize(button.getAttribute('aria-label') || button.innerText || button.textContent);
    const rect = button.getBoundingClientRect?.();
    return (!rect || rect.width > 0 && rect.height > 0) && labels.some(label => value === label || value.startsWith(label + ' '));
  });
  const button = document.createElement('button'); button.type = 'button'; button.setAttribute(ENTRY, '');
  button.setAttribute('aria-label', '综合任务清单');
  button.title = '先记下来，之后再确定归属';
  button.innerHTML = '<span aria-hidden="true" style="display:inline-flex;width:1.1rem;height:1.1rem;align-items:center;justify-content:center"><svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 3.5h12v13H4z"/><path d="M7 7h6M7 10h6M7 13h4"/></svg></span><span class="truncate">任务清单</span>';
  button.addEventListener('click', () => window.__cccProjectChecklist?.openGeneral());
  let disposed = false, scheduled = false;
  function place() {
    if (disposed) return;
    const openProject = document.querySelector('[data-codex-control-console-open-local-project]');
    const newChat = buttonBy(['新聊天', '新对话', '新建任务', 'New chat', 'New task']);
    const parent = openProject?.parentElement || newChat?.parentElement;
    if (!parent) return;
    if (newChat && button.className !== newChat.className) button.className = newChat.className;
    const anchor = openProject?.parentElement === parent ? openProject : newChat;
    if (button.parentElement !== parent || button.previousElementSibling !== anchor) parent.insertBefore(button, anchor.nextSibling);
  }
  function schedule() { if (disposed || scheduled) return; scheduled = true; requestAnimationFrame(() => { scheduled = false; place(); }); }
  const observer = new MutationObserver(schedule); observer.observe(document.documentElement, { childList: true, subtree: true });
  window.__cccGeneralChecklist = { version: VERSION, dispose() { disposed = true; observer.disconnect(); button.remove(); } };
  place();
}
export function buildNativeGeneralChecklistScript() { return `(${installNativeGeneralChecklist.toString()})();`; }
