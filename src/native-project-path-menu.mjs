// Native menu integration owns no React nodes and never changes native menu actions.
export function installNativeProjectPathMenu() {
  const VERSION = '2026-09-07.2';
  const KEY = '__codexControlConsoleProjectPathMenu';
  if (window[KEY]?.version === VERSION && window[KEY]?.ready) return;
  window[KEY]?.dispose();
  const bridge = window.electronBridge;
  const original = bridge?.showContextMenu;
  if (typeof original !== 'function') return;
  const ACTION = 'codex-control-console-copy-project-path', COPY_ID = ACTION + '-id', COPY_LINK = ACTION + '-link';
  let catalog = new Map(), generation = 0;
  function paths(values) {
    return [...new Set((Array.isArray(values) ? values : []).filter(value => typeof value === 'string' && value.trim()))];
  }
  function nativeProject(row) {
    const id = row.getAttribute('data-app-action-sidebar-project-id');
    const key = Object.keys(row).find(key => key.startsWith('__reactFiber'));
    let fiber = key ? row[key] : null, project = null, menu = null, formatter = null;
    for (let depth = 0; fiber && depth < 32; depth++, fiber = fiber.return) {
      const props = fiber.memoizedProps || {}, group = props.group;
      if (!menu && typeof props.getItems === 'function') {
        menu = props;
        let dependency = fiber.dependencies?.firstContext;
        for (let index = 0; dependency && index < 12; index++, dependency = dependency.next) {
          if (typeof dependency.memoizedValue?.formatMessage === 'function') { formatter = dependency.memoizedValue.formatMessage; break; }
        }
      }
      if (group?.projectId === id && group.projectKind === 'local') project = { id, sourceDirectories: paths(group.rootPaths) };
      const gizmo = props.project?.gizmo || props.project?.project?.gizmo;
      if (gizmo?.id === id && /^g-p-[a-zA-Z0-9-]+$/.test(id)) project = { id, sourceDirectories: [], cloud: true, link: 'https://chatgpt.com/g/' + encodeURIComponent(gizmo.short_url || id) + '/project' };
      if (project && menu && formatter) return { ...project, name: group?.label || group?.name || row.textContent?.trim(), menu, formatter };
    }
    return null;
  }
  function serialize(items, format) {
    return items.map(entry => {
      const label = entry.type === 'separator' ? '' : entry.message ? format(entry.message, entry.messageValues) : entry.id;
      return { id: entry.id, type: ['separator', 'radio'].includes(entry.type) ? entry.type : undefined,
        checked: entry.type === 'radio' ? entry.checked === true : undefined,
        label: entry.type !== 'radio' && entry.checked === true ? '✓ ' + label : label,
        icon: typeof entry.icon === 'string' ? entry.icon : undefined, accelerator: entry.accelerator,
        enabled: entry.enabled ?? true, toolTip: entry.tooltipMessage ? format(entry.tooltipMessage, entry.tooltipMessageValues) : undefined,
        submenu: entry.submenu ? serialize(entry.submenu, format) : undefined };
    });
  }
  function findAction(items, id) {
    for (const entry of items) {
      if (entry.type === 'separator' || entry.enabled === false) continue;
      if (entry.id === id) return entry;
      const child = entry.submenu && findAction(entry.submenu, id); if (child) return child;
    }
    return null;
  }
  function notice(message) {
    const node = document.createElement('div'); node.textContent = message; node.setAttribute('role', 'status');
    node.style.cssText = 'position:fixed;z-index:2147483647;left:50%;bottom:28px;transform:translateX(-50%);padding:8px 12px;border-radius:9px;background:var(--color-background-primary,#252525);color:var(--color-text);box-shadow:0 8px 24px #0004;font:13px/20px system-ui;';
    document.body.append(node); setTimeout(() => node.remove(), 1600);
  }
  async function copy(path, message = '项目路径已复制') {
    if (typeof path !== 'string' || !path.trim()) return;
    let copied = false;
    try { await navigator.clipboard.writeText(path); copied = true; }
    catch {
      const input = document.createElement('textarea'); input.value = path;
      input.style.cssText = 'position:fixed;left:-9999px;top:0;';
      try { document.body.append(input); input.select(); copied = document.execCommand('copy'); }
      catch { copied = false; }
      finally { input.remove(); }
    }
    notice(copied ? message : '复制失败，请重试');
  }
  function copyItems(project) {
    const roots = project.sourceDirectories || [];
    if (!roots.length) return [...(project.link ? [{ id: COPY_LINK, label: '复制项目链接', enabled: true }] : []), { id: COPY_ID, label: '复制项目 ID', enabled: true }];
    const items = [{ id: ACTION, label: '复制项目路径', enabled: roots.length > 0,
      toolTip: roots.length > 1 ? '复制全部路径，每行一个' : roots[0] || '项目路径不可用' }];
    if (roots.length > 1) items.push({ id: ACTION + '-individual', label: '复制单个项目路径', submenu: roots.map((path, index) => ({ id: ACTION + ':' + index, label: path, enabled: true })) });
    return items;
  }
  function folderItems(project) {
    if (!project.sourceDirectories?.length || !window.__cccProjectSearchActions) return [];
    const remote = project.device?.kind === 'remote-codex';
    const platform = navigator.userAgentData?.platform || navigator.platform || '';
    const label = /win/i.test(platform) ? '在资源管理器中打开' : /mac/i.test(platform) ? '在 Finder 中打开' : '在文件管理器中打开';
    const enabled = !remote && typeof window.__cccProjectSearchActions?.openFolder === 'function';
    if (remote) return [{ id: 'ccc-open-project-folder', label: '请在 ' + project.device.name + ' 上打开文件夹', enabled: false }];
    const entries = project.sourceDirectories.map((path, index) => ({ id: 'ccc-open-project-folder:' + index, label: path, enabled }));
    return entries.length === 1 ? [{ ...entries[0], label }] : [{ id: 'ccc-open-project-folder', label, submenu: entries }];
  }
  function locateItems(project) {
    if (!project.searchResult) return [];
    const remote = project.device?.kind === 'remote-codex';
    return [{ id: 'ccc-open-in-project', label: '在项目中打开', enabled: !remote && typeof window.__cccProjectSearchActions?.openInProject === 'function',
      toolTip: remote ? '请在 ' + project.device.name + ' 上定位项目' : '在项目分区中定位，并打开第一个会话' }];
  }
  async function show(project, token) {
    let items = [];
    if (project.menu) {
      await project.menu.onBeforeOpen?.();
      items = await project.menu.getItems();
      if (!Array.isArray(items) || !items.some(entry => entry.id === 'edit-project') || !items.some(entry => entry.id === (project.cloud ? 'delete-chatgpt-project' : 'remove-project'))) throw new Error('Unsupported project menu');
    }
    if (token !== generation) return;
    const nativeItems = [...locateItems(project), ...(window.__cccProjectChecklist ? [{ id: 'ccc-project-checklist', label: '任务清单', enabled: true }] : []), ...folderItems(project), ...copyItems(project), ...(items.length ? [{ type: 'separator', label: '' }, ...serialize(items, project.formatter)] : [])];
    project.menu?.onOpenChange?.(true);
    let selection;
    try { selection = await original.call(bridge, nativeItems); }
    finally { project.menu?.onOpenChange?.(false); }
    if (token !== generation) return;
    if (selection?.id === 'ccc-open-in-project') { window.__cccProjectSearchActions?.openInProject(project); return; }
    const folderIndex = (project.sourceDirectories || []).findIndex((_, index) => selection?.id === 'ccc-open-project-folder:' + index);
    if (folderIndex >= 0) { await window.__cccProjectSearchActions?.openFolder(project, project.sourceDirectories[folderIndex]); return; }
    if (selection?.id === 'ccc-project-checklist') { window.__cccProjectChecklist?.open({ id: project.id, key: project.key || project.id, name: project.name || project.id }); return; }
    if (selection?.id === COPY_ID) { await copy(project.id, '项目 ID 已复制'); return; }
    if (selection?.id === COPY_LINK) { await copy(project.link, '项目链接已复制'); return; }
    if (selection?.id === ACTION) { await copy((project.sourceDirectories || []).join('\n')); return; }
    const pathIndex = (project.sourceDirectories || []).findIndex((_, index) => selection?.id === ACTION + ':' + index);
    if (pathIndex >= 0) { await copy(project.sourceDirectories[pathIndex]); return; }
    const action = findAction(items, selection?.id);
    await action?.onSelect?.();
  }
  function capture(event) {
    const token = ++generation;
    const target = event.target?.closest?.('[data-app-action-sidebar-project-id], [data-new-project-id], [data-project-search-id]');
    if (!target) return;
    let project;
    if (target.hasAttribute('data-app-action-sidebar-project-id')) {
      project = nativeProject(target);
      if (!project) return;
    } else {
      const id = target.getAttribute('data-new-project-id') || target.getAttribute('data-project-search-id');
      project = catalog.get(id) || { id, sourceDirectories: [] };
    }
    event.preventDefault(); event.stopPropagation();
    void show(project, token).catch(() => notice('无法打开项目菜单，请重试'));
  }
  document.addEventListener('contextmenu', capture, true);
  window[KEY] = { version: VERSION, ready: true,
    set(projects) { catalog = new Map((Array.isArray(projects) ? projects : []).map(project => [project.searchKey || project.id, { id: project.id, device: project.device, key: project.device?.kind === 'remote-codex' ? project.searchKey : project.checklistKey || project.id, name: project.name || project.displayName, sourceDirectories: paths(project.sourceDirectories || [project.sourceDirectory]), tasks: Array.isArray(project.tasks) ? project.tasks.slice(0, 160) : [], searchResult: Boolean(project.searchKey) }])); },
    dispose() { generation++; document.removeEventListener('contextmenu', capture, true); }
  };
}

export function buildNativeProjectPathMenuScript(projects = []) {
  return `(${installNativeProjectPathMenu.toString()})();window.__codexControlConsoleProjectPathMenu?.set(${JSON.stringify(projects).replaceAll('<', '\\u003c')});`;
}
