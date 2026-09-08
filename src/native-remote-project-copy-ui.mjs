export function buildNativeRemoteProjectCopyUiSource() {
  return `
  let projectMenu = null;
  function closeProjectMenu() { projectMenu?.remove(); projectMenu = null; }
  function showCopyNotice(message) {
    const notice = element('div', message, 'position:fixed;z-index:2147483647;left:50%;bottom:28px;transform:translateX(-50%);padding:8px 12px;border-radius:9px;background:var(--color-background-primary,#252525);color:var(--color-text);box-shadow:0 8px 24px rgba(0,0,0,.25);font:13px/20px -apple-system,system-ui,"Segoe UI",sans-serif;');
    notice.setAttribute('role', 'status'); document.body.append(notice); setTimeout(() => notice.remove(), 1600);
  }
  async function copyMenuText(value, successMessage) {
    if (typeof value !== 'string' || !value.trim()) return false;
    let copied = false;
    try { await navigator.clipboard.writeText(value); copied = true; }
    catch {
      const input = element('textarea', value, 'position:fixed;left:-9999px;top:0;');
      try { document.body.append(input); input.select(); copied = document.execCommand('copy'); }
      catch { copied = false; }
      finally { input.remove(); }
    }
    if (!copied) { showCopyNotice('复制失败，请重试'); return false; }
    closeProjectMenu(); showCopyNotice(successMessage); return true;
  }
  function copyRemoteThreadId(threadId) { return copyMenuText(String(threadId || '').trim(), '会话 ID 已复制'); }
  function requestProjectCopy(device, project) {
    closeProjectMenu();
    if (device.status !== 'connected' || !project.sourceDirectory) return false;
    return window.__codexControlConsoleCopyRemoteProject?.({ deviceId: device.id, sourceDirectory: project.sourceDirectory, projectName: project.name }) || false;
  }
  function openProjectMenu(event, device, project) {
    event.preventDefault(); event.stopPropagation(); closeProjectMenu();
    const available = device.status === 'connected' && Boolean(project.sourceDirectory);
    const menu = element('div', null, 'position:fixed;z-index:2147483646;min-width:190px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);overflow:auto;padding:5px;border:1px solid rgba(128,128,128,.24);border-radius:10px;background:var(--color-background-primary,#252525);color:var(--color-text);box-shadow:0 10px 30px rgba(0,0,0,.24);font:13px/20px -apple-system,system-ui,"Segoe UI",sans-serif;');
    menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', project.name + ' 项目操作');
    const action = element('button', available ? '复制项目到本机…' : device.status !== 'connected' ? '设备离线，无法复制' : '项目包含多个工作目录');
    action.type = 'button'; action.disabled = !available; action.setAttribute('role', 'menuitem');
    action.style.cssText = 'display:block;width:100%;padding:7px 10px;border:0;border-radius:7px;background:transparent;color:inherit;text-align:left;font:inherit;cursor:' + (available ? 'pointer' : 'default') + ';opacity:' + (available ? '1' : '.5') + ';';
    if (available) { action.addEventListener('mouseenter', () => { action.style.background = 'rgba(128,128,128,.16)'; }); action.addEventListener('mouseleave', () => { action.style.background = 'transparent'; }); action.addEventListener('click', () => requestProjectCopy(device, project)); }
    const copyPath = element('button', '复制项目路径');
    const paths = [...new Set((project.sourceDirectories || [project.sourceDirectory]).filter(path => typeof path === 'string' && path.trim()))];
    const hasPath = paths.length > 0, canCopy = hasPath || Boolean(project.key);
    if (!hasPath && project.key) copyPath.textContent = '复制项目 ID';
    copyPath.type = 'button'; copyPath.disabled = !canCopy; copyPath.setAttribute('role', 'menuitem');
    copyPath.style.cssText = action.style.cssText; copyPath.style.cursor = canCopy ? 'pointer' : 'default'; copyPath.style.opacity = canCopy ? '1' : '.5';
    if (canCopy) {
      copyPath.addEventListener('mouseenter', () => { copyPath.style.background = 'rgba(128,128,128,.16)'; });
      copyPath.addEventListener('mouseleave', () => { copyPath.style.background = 'transparent'; });
      copyPath.addEventListener('click', () => copyMenuText(hasPath ? paths.join('\\n') : project.key, hasPath ? '项目路径已复制' : '项目 ID 已复制'));
    } else { copyPath.title = '项目路径不可用'; }
    menu.append(copyPath);
    if (paths.length > 1) for (const path of paths) {
      const single = element('button', path); single.type = 'button'; single.setAttribute('role', 'menuitem'); single.style.cssText = copyPath.style.cssText;
      single.title = '复制此路径'; single.addEventListener('click', () => copyMenuText(path, '项目路径已复制')); menu.append(single);
    }
    menu.append(action);
    if (unifiedSidebar.enabled) for (const target of unifiedSidebar.destinations()) {
      const move = element('button', (unifiedSidebar.destination(device, project) === target.key ? '✓ ' : '移入 ') + target.label);
      move.type = 'button'; move.setAttribute('role', 'menuitem'); move.style.cssText = action.style.cssText; move.style.opacity = '1'; move.style.cursor = 'pointer';
      move.addEventListener('click', () => unifiedSidebar.assign(device, project, target.key)); menu.append(move);
    }
    document.body.append(menu); projectMenu = menu;
    const rect = menu.getBoundingClientRect(); menu.style.left = Math.max(8, Math.min(event.clientX, innerWidth - rect.width - 8)) + 'px'; menu.style.top = Math.max(8, Math.min(event.clientY, innerHeight - rect.height - 8)) + 'px';
    queueMicrotask(() => { if (canCopy) copyPath.focus(); else if (available) action.focus(); });
  }
  function openConversationMenu(event, conversation) {
    event.preventDefault(); event.stopPropagation(); closeProjectMenu();
    const menu = element('div', null, 'position:fixed;z-index:2147483646;min-width:190px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);overflow:auto;padding:5px;border:1px solid rgba(128,128,128,.24);border-radius:10px;background:var(--color-background-primary,#252525);color:var(--color-text);box-shadow:0 10px 30px rgba(0,0,0,.24);font:13px/20px -apple-system,system-ui,"Segoe UI",sans-serif;');
    menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', conversation.title + ' 会话操作');
    const action = element('button', '复制会话 ID'); action.type = 'button'; action.setAttribute('role', 'menuitem');
    action.style.cssText = 'display:block;width:100%;padding:7px 10px;border:0;border-radius:7px;background:transparent;color:inherit;text-align:left;font:inherit;cursor:pointer;';
    action.addEventListener('mouseenter', () => { action.style.background = 'rgba(128,128,128,.16)'; }); action.addEventListener('mouseleave', () => { action.style.background = 'transparent'; });
    action.addEventListener('click', () => void copyRemoteThreadId(conversation.id));
    menu.append(action); document.body.append(menu); projectMenu = menu;
    const rect = menu.getBoundingClientRect(); menu.style.left = Math.max(8, Math.min(event.clientX, innerWidth - rect.width - 8)) + 'px'; menu.style.top = Math.max(8, Math.min(event.clientY, innerHeight - rect.height - 8)) + 'px';
    queueMicrotask(() => action.focus());
  }
  window.__codexControlConsoleRemoteProjectMenuDismiss?.();
  const dismiss = (event) => { if (projectMenu && !projectMenu.contains(event.target)) closeProjectMenu(); };
  document.addEventListener('pointerdown', dismiss, true); document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeProjectMenu(); }, true);
  window.__codexControlConsoleRemoteProjectMenuDismiss = () => { document.removeEventListener('pointerdown', dismiss, true); closeProjectMenu(); };
  `;
}
