export function buildNativeRemoteSidebarRenderSource() {
  return `  function render() {
    unifiedSidebar.reset();
    const typography = nativeTypography();
    const templates = nativeTemplates();
    templateSignature = templatesSignature(templates);
    const nextRoot = element('section', null, 'display:block;color:inherit;');
    nextRoot.setAttribute('data-codex-control-console-remote-sidebar', '');
    if (!unifiedSidebar.enabled) nextRoot.append(nativeSectionHeader('远端', templates));
    for (const device of devices) {
        const open = expandedDevices.has(device.id);
        const count = device.status === 'connected' ? device.projectCount : '离线';
        const deviceRow = nativeTreeRow(device.name, count, deviceIcon(), templates, 0);
        deviceRow.title = device.status === 'connected' ? device.name + ' · ' + device.projectCount + ' 项目 · ' + device.conversationCount + ' 会话' : device.name + ' · 离线';
        deviceRow.addEventListener('click', () => { if (open) expandedDevices.delete(device.id); else expandedDevices.add(device.id); render(); ensurePlacement(); });
        deviceRow.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); deviceRow.click(); } });
        if (!unifiedSidebar.enabled) nextRoot.append(deviceRow);
        if (!open && !unifiedSidebar.enabled) continue;
      if (!device.projects.length) (unifiedSidebar.enabled ? unifiedSidebar.container(device) : nextRoot).append(applyTypography(element('div', device.name + (device.status === 'connected' ? ' · 暂无项目或会话' : ' · 设备暂时不可达'), 'padding:3px 20px 7px 34px;'), typography.conversation, 'var(--color-text-tertiary)'));
      for (const project of (unifiedSidebar.enabled ? device.projects : visibleRemoteProjects(device))) {
        const projectContainer = unifiedSidebar.enabled ? unifiedSidebar.container(device, project) : nextRoot;
        const stateKey = device.id + '\\n' + project.key;
        const projectOpen = expandedProjects.has(stateKey);
        const projectRow = nativeTreeRow(project.name, project.conversationCount, templates.projectIcon, templates, unifiedSidebar.enabled ? 0 : 1);
        projectRow.setAttribute('aria-expanded', String(projectOpen));
        projectRow.setAttribute('data-codex-control-console-remote-project', JSON.stringify([device.id, project.key]));
        if (unifiedSidebar.enabled) {
          projectRow.style.gap = '6px'; projectRow.firstElementChild.style.minWidth = '0'; projectRow.firstElementChild.style.overflow = 'hidden';
          const badge = projectRow.lastElementChild;
          badge.textContent = device.name + (device.status === 'connected' ? ' · ' + project.conversationCount : ' · 离线');
          badge.title = badge.textContent; badge.style.cssText = 'flex:0 1 auto;max-width:46%;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:17px;padding:0 5px;border:1px solid #8884;border-radius:8px;';
          projectRow.setAttribute('aria-label', project.name + ' · ' + badge.textContent);
        }
        projectRow.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); projectRow.click(); } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { const rect = projectRow.getBoundingClientRect(); openProjectMenu({ preventDefault() { event.preventDefault(); }, stopPropagation() { event.stopPropagation(); }, clientX: rect.left, clientY: rect.bottom }, device, project); } });
        projectRow.addEventListener('click', () => {
          if (projectOpen) expandedProjects.delete(stateKey); else expandedProjects.add(stateKey);
          render(); ensurePlacement();
        });
        projectRow.addEventListener('contextmenu', (event) => openProjectMenu(event, device, project));
        projectRow.title = project.sourceDirectory ? project.name + ' · 右键复制项目' : project.name;
        projectContainer.append(projectRow);
        if (!projectOpen) continue;
        for (const conversation of project.conversations) {
          const available = device.status === 'connected';
          const row = nativeThreadRow(conversation, templates, unifiedSidebar.enabled ? 1 : 2);
          const conversationKey = device.id + '\\n' + conversation.id;
          if (selectedConversationKey === conversationKey) { row.setAttribute('data-app-action-sidebar-thread-selected', 'true'); row.setAttribute('aria-current', 'page'); }
          row.setAttribute('aria-disabled', String(!available));
          if (!available) row.style.opacity = '.62';
          row.title = available ? '打开远端对话：' + conversation.title : '设备离线，暂时无法打开：' + conversation.title;
          row.setAttribute('aria-label', row.title);
          row.addEventListener('contextmenu', (event) => openConversationMenu(event, conversation));
          if (available) {
            row.addEventListener('click', () => {
              selectedConversationKey = conversationKey; window.__codexControlConsoleSelectedRemoteConversation = conversationKey; document.documentElement.setAttribute(REMOTE_SELECTED_ATTRIBUTE, ''); render(); ensurePlacement();
              openRemoteConversation({ id: conversation.id, deviceId: device.id, title: conversation.title, cwd: project.sourceDirectory, deviceName: device.name });
            });
            row.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); row.click(); } });
          }
          projectContainer.append(row);
        }
        if (project.hiddenConversationCount) projectContainer.append(applyTypography(element('div', '另有 ' + project.hiddenConversationCount + ' 个会话', 'padding:2px 18px 5px 49px;'), typography.conversation, 'var(--color-text-tertiary)'));
      }
      if (!unifiedSidebar.enabled) appendRemoteProjectListControls(nextRoot, device, typography);
      else if (device.hiddenProjectCount) unifiedSidebar.container(device).append(element('div', device.name + ' · 另有 ' + device.hiddenProjectCount + ' 个项目未载入'));
      }
    root?.replaceWith(nextRoot);
    root = nextRoot;
  }
`;
}
