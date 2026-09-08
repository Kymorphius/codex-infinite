export function buildNativeRemoteProjectListUiSource() {
  return `
  const INITIAL_VISIBLE_PROJECTS = 12;
  function visibleRemoteProjects(device) { return expandedProjectLists.has(device.id) ? device.projects : device.projects.slice(0, INITIAL_VISIBLE_PROJECTS); }
  function appendRemoteProjectListControls(container, device, typography) {
    const expanded = expandedProjectLists.has(device.id), revealCount = Math.max(0, device.projects.length - INITIAL_VISIBLE_PROJECTS);
    if (revealCount) {
      const reveal = applyTypography(element('button', expanded ? '收起到前 ' + INITIAL_VISIBLE_PROJECTS + ' 个项目' : '显示另外 ' + revealCount + ' 个项目', 'display:block;width:calc(100% - 34px);margin:1px 0 4px 34px;padding:3px 0;border:0;background:transparent;text-align:left;cursor:pointer;'), typography.conversation, 'var(--color-text-tertiary)');
      reveal.type = 'button'; reveal.setAttribute('aria-expanded', String(expanded)); reveal.addEventListener('click', () => { if (expanded) expandedProjectLists.delete(device.id); else expandedProjectLists.add(device.id); render(); ensurePlacement(); }); container.append(reveal);
    }
    if (device.hiddenProjectCount) container.append(applyTypography(element('div', '另有 ' + device.hiddenProjectCount + ' 个项目未载入', 'padding:3px 18px 5px 34px;'), typography.conversation, 'var(--color-text-tertiary)'));
  }
  `;
}
