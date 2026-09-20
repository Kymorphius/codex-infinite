// Controls always address a source device and its current native revision.
export function installSidebarMenu({ request, refresh, getDevices }) {
  let panel;
  const label = section => ({ projects: '项目', tasks: '聊天', pinned: '置顶' })[section.kind] || section.name;
  const node = (tag, text) => { const value = document.createElement(tag); if (text) value.textContent = text; return value; };
  function close() { panel?.remove(); panel = null; }
  function show(title) {
    close(); panel = node('div'); panel.setAttribute('data-codex-sidebar-menu', ''); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', title);
    panel.style.cssText = 'position:fixed;z-index:10000;top:70px;left:20px;max-height:75vh;overflow:auto;width:320px;padding:14px;border:1px solid #8886;border-radius:12px;background:var(--color-background-elevated,#252525);color:var(--color-text-primary,#eee);box-shadow:0 8px 32px #0005;font-size:13px;-webkit-app-region:no-drag';
    const header = node('strong', title), dismiss = node('button', '关闭'); dismiss.style.cssText = 'float:right'; dismiss.onclick = close;
    panel.append(header, dismiss, node('hr')); document.body.append(panel); panel.addEventListener('keydown', event => { if (event.key === 'Escape') close(); }); dismiss.focus(); return panel;
  }
  function button(parent, label, click, disabled = false) {
    const element = node('button', label); element.disabled = disabled;
    element.style.cssText = 'padding:5px 8px;margin:3px;border:1px solid #8885;border-radius:5px;font:inherit;opacity:' + (disabled ? '.45' : '1');
    element.onclick = click; parent.append(element); return element;
  }
  async function apply(device, input) {
    const current = getDevices().find(value => value.device.id === device.device.id);
    if (input.action === 'sidebar-show') return request('apply', { action: 'sidebar-show', deviceId: device.device.id });
    if (current?.status !== 'connected') throw Error('所属设备当前不可用');
    // Keep the revision captured with the displayed menu, never silently upgrade stale intent.
    return request('apply', { ...input, deviceId: device.device.id, expectedRevision: device.snapshot.revision });
  }
  async function run(device, input) {
    const current = panel, buttons = Array.from(current?.querySelectorAll('button') || []).map(element => [element, element.disabled]);
    buttons.forEach(([element]) => { element.disabled = true; });
    const progress = node('p', '正在由 ' + device.device.name + ' 执行并确认…'); current?.append(progress);
    try { await apply(device, input); close(); await refresh(); }
    catch (error) { if (current?.isConnected) { progress.textContent = error.message; buttons.forEach(([element, disabled]) => { element.disabled = disabled; }); } await refresh(); }
  }
  function item(device, section, record) {
    const content = show(record.name || record.title); content.append(node('p', '所属设备：' + device.device.name));
    const disabled = device.status !== 'connected';
    const project = device.snapshot.projects.some(value => value.key === record.key);
    for (const target of device.snapshot.sections) {
      if ((target.kind === 'projects' && !project) || (target.kind === 'tasks' && project)) continue;
      button(content, (target.id === section.id ? '✓ ' : '移入 ') + label(target),
        () => run(device, { action: 'item-move', sectionId: section.id, targetSectionId: target.id, itemKey: record.key }), disabled || target.id === section.id || !device.snapshot.capabilities.includes('item-move'));
    }
    if (section.itemKeys.includes(record.key)) for (const direction of [-1, 1]) button(content, direction < 0 ? '上移' : '下移', () => run(device, { action: 'item-shift', sectionId: section.id, itemKey: record.key, direction }), disabled);
    button(content, '在所属设备打开', () => run(device, { action: 'open', sectionId: section.id, itemKey: record.key }), disabled);
  }
  function manage() {
    const content = show('管理各设备原生分区');
    for (const device of getDevices()) {
      content.append(node('h3', device.device.name + (device.status === 'connected' ? '' : ' · ' + (device.message || '不可用'))));
      if (device.status !== 'connected') button(content, '显示该设备分区', () => run(device, { action: 'sidebar-show' }));
      if (!device.snapshot) continue;
      const disabled = device.status !== 'connected';
      const input = node('input'); input.placeholder = '新分区名称'; input.maxLength = 100; input.style.cssText = 'border:1px solid #8886;padding:5px;width:165px'; content.append(input);
      button(content, '新建', () => run(device, { action: 'section-create', name: input.value }), disabled || !device.snapshot.capabilities.includes('section-create'));
      for (const section of device.snapshot.sections) {
        const line = node('div'); line.style.cssText = 'padding:5px 0;border-bottom:1px solid #8883'; content.append(line);
        if (section.kind === 'custom') {
          const name = node('input'); name.value = section.name; name.maxLength = 100; name.style.cssText = 'width:150px;border:1px solid #8884;padding:4px'; line.append(name);
          button(line, '改名', () => run(device, { action: 'section-rename', sectionId: section.id, name: name.value }), disabled);
          button(line, '删除', () => { const confirm = show('删除 ' + section.name + '？'); confirm.append(node('p', '将删除 ' + device.device.name + ' 上的这个分区；条目回到原生默认分区。')); button(confirm, '确认删除分区', () => run(device, { action: 'section-delete', sectionId: section.id })); }, disabled);
        } else line.append(node('span', label(section)));
        for (const direction of [-1, 1]) button(line, direction < 0 ? '↑' : '↓', () => run(device, { action: 'section-shift', sectionId: section.id, direction }), disabled);
      }
    }
  }
  return { item, manage, close };
}
