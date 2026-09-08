// Own an additive sidebar root; native project sections remain React-owned.
export function installNativeGeneralChecklist() {
  const VERSION = '2026-09-07.2';
  if (window.__cccGeneralChecklist?.version === VERSION) return;
  window.__cccGeneralChecklist?.dispose();
  const root = document.createElement('div'); root.setAttribute('data-ccc-general-checklist-entry', '');
  root.style.cssText = 'order:0;padding:4px 8px 10px';
  const button = document.createElement('button'); button.type = 'button';
  button.textContent = '☷  综合任务清单'; button.setAttribute('aria-label', '综合任务清单');
  button.title = '先记下来，之后再确定归属';
  button.style.cssText = 'display:flex;align-items:center;width:100%;padding:8px;border-radius:8px;text-align:left;font:500 14px/20px system-ui;color:inherit;background:transparent;cursor:pointer;-webkit-app-region:no-drag';
  button.addEventListener('click', () => window.__cccProjectChecklist?.openGeneral());
  root.append(button);
  let disposed = false, scheduled = false;
  function place() {
    if (disposed) return;
    const native = document.querySelector('section[data-app-action-sidebar-section-heading="Projects"]');
    const parent = native?.parentElement?.parentElement;
    if (parent && root.parentElement !== parent) parent.append(root);
  }
  function schedule() { if (disposed || scheduled) return; scheduled = true; requestAnimationFrame(() => { scheduled = false; place(); }); }
  const observer = new MutationObserver(schedule); observer.observe(document.documentElement, { childList: true, subtree: true });
  window.__cccGeneralChecklist = { version: VERSION, dispose() { disposed = true; observer.disconnect(); root.remove(); } };
  place();
}
export function buildNativeGeneralChecklistScript() { return `(${installNativeGeneralChecklist.toString()})();`; }
