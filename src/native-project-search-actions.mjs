// Adapter for owned project aliases; native Codex owns drafts and file opening.
export function installNativeProjectSearchActions(resolveServices) {
  const VERSION = '2026-09-30.layout-surface1';
  if (window.__cccProjectSearchActions?.version === VERSION) return;
  let servicePromise;
  const local = project => project?.device?.kind !== 'remote-codex';
  function notice(message) {
    const node = document.createElement('div');
    node.textContent = message; node.setAttribute('role', 'status');
    node.style.cssText = 'position:fixed;z-index:2147483647;bottom:28px;left:50%;transform:translateX(-50%);padding:8px 12px;border-radius:8px;background:var(--color-surface-elevated,var(--color-surface,#252525));color:var(--color-text);font:13px/20px system-ui;';
    document.body.append(node); setTimeout(() => node.remove(), 3000);
  }
  async function services() {
    if (resolveServices) return resolveServices();
    if (!servicePromise) servicePromise = (async () => {
      const resources = performance.getEntriesByType('resource').map(entry => entry.name);
      const elements = [...document.querySelectorAll('script[src],link[rel="modulepreload"][href]')].map(node => node.src || node.href);
      const urls = [...new Set([...resources, ...elements])]
        .filter(value => { try { const url = new URL(value); return url.protocol === 'app:' && url.host === '-' && /^\/assets\/app-(initial|primary)-[\w-]+\.js$/.test(url.pathname); } catch { return false; } });
      if (!urls.some(url => /\/app-initial-/.test(url))) {
        const boot = elements.find(value => /^app:\/\/-\/assets\/(?:index|app-main)-[\w-]+\.js$/.test(value));
        if (boot) {
          const source = await (await fetch(boot)).text();
          const entry = source.match(/app-initial-[\w-]+\.js/);
          if (entry) urls.push(new URL(entry[0], boot).href);
        }
      }
      for (const url of urls) {
        try {
          const module = await import(url);
          const service = Object.values(module).find(value => value && typeof value === 'object' && typeof value.openIn?.open === 'function');
          if (service) return service;
        } catch { /* Another app chunk may not be importable in this renderer. */ }
      }
      throw new Error('原生文件管理器接口尚未就绪');
    })().catch(error => { servicePromise = null; throw error; });
    return servicePromise;
  }
  async function create(project) {
    if (!local(project)) { notice('请在项目所属设备上新建会话'); return false; }
    const projectId = project?.checklistKey || project?.id; // Catalog's native sidebar identity.
    if (!projectId) { notice('项目暂不可用，请刷新后重试'); return false; }
    const row = Array.from(document.querySelectorAll('[data-app-action-sidebar-project-id]'))
      .find(node => node.getAttribute('data-app-action-sidebar-project-id') === projectId);
    const button = row && Array.from(row.querySelectorAll('button')).find(node => /开始新聊天|新建会话|Start new chat|New chat in/i.test(node.getAttribute('aria-label') || ''));
    if (button && !button.disabled) {
      window.__codexControlConsoleClose?.(); button.click(); return true;
    }
    try {
      if (!window.__cccNativeNewTask?.start) throw Error('unavailable');
      return await window.__cccNativeNewTask.start(projectId);
    } catch { notice('原生新建任务入口尚未就绪，请稍后重试'); return false; }
  }

  async function openFolder(project, path) {
    const roots = project?.sourceDirectories || [];
    if (!local(project) || !roots.includes(path)) { notice('请在项目所属设备上打开文件夹'); return false; }
    try {
      const result = await (await services()).openIn.open({ cwd: null, path, target: 'fileManager' });
      if (result?.success !== true) throw new Error('文件夹无法打开');
      return true;
    } catch { notice('无法打开项目文件夹，请检查路径或重试'); return false; }
  }
  function openInProject(project) {
    if (!local(project)) { notice('请在项目所属设备上定位项目'); return false; }
    const projectId = project?.key || project?.checklistKey || project?.id;
    if (!projectId) { notice('项目暂不可用，请刷新后重试'); return false; }
    const projectRow = Array.from(document.querySelectorAll('[data-app-action-sidebar-project-id]'))
      .find(node => node.getAttribute('data-app-action-sidebar-project-id') === projectId);
    if (!projectRow) { notice('项目尚未出现在项目分区，请刷新后重试'); return false; }
    window.__codexControlConsoleClose?.();
    projectRow.scrollIntoView?.({ block: 'center', behavior: 'instant' });
    let expanded = projectRow.getAttribute('data-app-action-sidebar-project-collapsed') !== 'true';
    if (!expanded) { projectRow.click(); expanded = true; }
    const firstTaskId = project?.tasks?.[0]?.id;
    let attempts = 0;
    const openFirst = () => {
      const rows = Array.from(document.querySelectorAll('[data-app-action-sidebar-thread-id]'));
      const exact = firstTaskId && rows.find(node => {
        const value = node.getAttribute('data-app-action-sidebar-thread-id') || '';
        return value === firstTaskId || value === 'local:' + firstTaskId;
      });
      const projectList = Array.from(document.querySelectorAll('[data-app-action-sidebar-project-list-id]')).find(node => {
        const value = node.getAttribute('data-app-action-sidebar-project-list-id') || '';
        return value === projectId || value === 'local-' + projectId;
      });
      const first = exact || projectList?.querySelector?.('[data-app-action-sidebar-thread-id]');
      if (first) { first.scrollIntoView?.({ block: 'center', behavior: 'instant' }); first.click?.(); return; }
      attempts += 1;
      if (attempts < 20) setTimeout(openFirst, 50);
    };
    setTimeout(openFirst, 0);
    return true;
  }
  window.__cccProjectSearchActions = { version: VERSION, create, openFolder, openInProject };
}
