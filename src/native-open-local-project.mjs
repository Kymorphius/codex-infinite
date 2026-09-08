export function nativeOpenProjectCopy(platform = "") {
  const value = String(platform).toLowerCase();
  if (value.includes("mac")) return Object.freeze({ label: "打开本地项目", help: "从 Finder 选择文件夹并打开项目" });
  if (value.includes("win")) return Object.freeze({ label: "打开本地项目", help: "从文件资源管理器选择文件夹并打开项目" });
  return Object.freeze({ label: "打开本地项目", help: "选择文件夹并打开项目" });
}

export function buildNativeOpenLocalProjectInjectionScript() {
  return `(() => {
  const VERSION = '2026-09-04.2';
  const ENTRY = 'data-codex-control-console-open-local-project';
  const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
  const copy = ${nativeOpenProjectCopy.toString()}(navigator.userAgentData?.platform || navigator.platform || navigator.userAgent);
  const isVisible = (element) => {
    if (!element?.isConnected) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const buttonBy = (root, labels) => Array.from(root.querySelectorAll('button,[role="button"]')).find((button) => {
    const value = normalize(button.getAttribute('aria-label') || button.innerText || button.textContent);
    return labels.some((label) => value === label || value.startsWith(label + ' '));
  });
  const nativeAddProject = () => buttonBy(document, ['添加新项目', 'Add project', 'Create new project']);
  const waitFor = (read, timeout = 1200) => new Promise((resolve) => {
    const immediate = read();
    if (immediate) { resolve(immediate); return; }
    const observer = new MutationObserver(() => {
      const value = read();
      if (!value) return;
      observer.disconnect(); clearTimeout(timer); resolve(value);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'aria-checked', 'data-state'] });
    const timer = setTimeout(() => { observer.disconnect(); resolve(null); }, timeout);
  });

  async function openLocalProject() {
    const trigger = nativeAddProject();
    if (!trigger) return false;
    trigger.click();
    const dialog = await waitFor(() => Array.from(document.querySelectorAll('[role="dialog"]')).find(isVisible));
    if (!dialog) return true;
    const local = buttonBy(dialog, ['本地', 'Local']);
    if (!local) return true;
    local.click();
    const next = await waitFor(() => {
      const candidate = buttonBy(dialog, ['下一步', 'Next']);
      return candidate && !candidate.disabled && candidate.getAttribute('aria-disabled') !== 'true' ? candidate : null;
    });
    if (!next) return true;
    next.click();
    const sourceFolder = await waitFor(() => buttonBy(document, ['选择源文件夹', 'Select source folder']), 1600);
    sourceFolder?.click();
    return true;
  }

  function install() {
    if (!document.body || document.querySelector('[' + ENTRY + ']')) return;
    const trigger = nativeAddProject();
    const newChat = buttonBy(document, ['新对话', 'New chat']);
    if (!trigger || !newChat?.parentElement) return;
    const entry = document.createElement('button');
    entry.type = 'button'; entry.className = newChat.className;
    entry.setAttribute(ENTRY, ''); entry.setAttribute('aria-label', copy.help); entry.title = copy.help;
    entry.innerHTML = '<span aria-hidden="true" style="display:inline-flex;width:1.1rem;height:1.1rem;align-items:center;justify-content:center"><svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M2.75 5.25h5l1.5 1.75h8v8.25h-14.5z" stroke-linejoin="round"/><path d="M2.75 7h14.5"/></svg></span><span class="truncate"></span>';
    entry.querySelector('.truncate').textContent = copy.label;
    entry.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); void openLocalProject(); });
    newChat.parentElement.insertBefore(entry, newChat.nextSibling);
  }

  if (window.__codexControlConsoleOpenLocalProjectVersion !== VERSION) {
    window.__codexControlConsoleOpenLocalProjectObserver?.disconnect?.();
    document.querySelectorAll('[' + ENTRY + ']').forEach((entry) => entry.remove());
    window.__codexControlConsoleOpenLocalProjectVersion = VERSION;
    window.__codexControlConsoleOpenLocalProjectObserver = new MutationObserver(() => {
      if (window.__codexControlConsoleOpenLocalProjectPending) return;
      window.__codexControlConsoleOpenLocalProjectPending = true;
      requestAnimationFrame(() => { window.__codexControlConsoleOpenLocalProjectPending = false; install(); });
    });
    window.__codexControlConsoleOpenLocalProjectObserver.observe(document.documentElement, { childList: true, subtree: true });
  }
  window.__codexControlConsoleOpenLocalProject = openLocalProject;
  install();
})()`;
}
