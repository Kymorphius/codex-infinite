export function createSourceSidebarRenderer({ readModel, onItem, openConversation }) {
  const roots = new Map(), disclosures = new Set();
  const element = (tag, text) => { const node = document.createElement(tag); if (text) node.textContent = text; return node; };
  function clear() { for (const root of roots.values()) root.remove(); roots.clear(); }
  function render(devices) {
    clear();
    let model; try { model = readModel(document); } catch { return; }
    const defaultSection = model.sections.find(section => section.kind === 'projects');
    const parent = defaultSection?.node.parentElement?.parentElement;
    if (!parent) return;
    const matches = new Map(), mirrors = new Map();
    for (const section of model.sections) {
      const key = section.kind === 'custom' ? 'custom:' + section.name : section.kind;
      if (!matches.has(key)) matches.set(key, []); matches.get(key).push(section);
    }
    for (const device of devices.filter(value => value.device.kind !== 'local-codex')) {
      if (!device.snapshot) {
        const status = element('div', device.device.name + ' · ' + (device.message || '正在连接'));
        status.style.cssText = 'padding:8px 16px;font-size:12px;opacity:.65'; status.setAttribute('data-codex-sidebar-source', device.device.id);
        parent.append(status); roots.set(device.device.id, status); continue;
      }
      const records = new Map([...device.snapshot.projects, ...device.snapshot.conversations].map(record => [record.key, record]));
      const occurrence = new Map();
      for (const section of device.snapshot.sections) {
        const key = section.kind === 'custom' ? 'custom:' + section.name : section.kind;
        const ordinal = occurrence.get(key) || 0; occurrence.set(key, ordinal + 1);
        const local = matches.get(key)?.[ordinal];
        const id = JSON.stringify([device.device.id, section.id]);
        const root = element('div'); root.setAttribute('data-codex-sidebar-source', device.device.id); root.setAttribute('data-codex-sidebar-section', section.id);
        root.style.cssText = 'display:flex;flex-direction:column;font-size:13px;padding:0 8px';
        root.addEventListener('pointerdown', event => event.stopPropagation()); root.addEventListener('dragstart', event => { event.preventDefault(); event.stopPropagation(); });
        roots.set(id, root);
        const mirrorKey = JSON.stringify([key, ordinal]);
        const collapsed = local ? local.native.collapsed : mirrors.get(mirrorKey)?.collapsed ?? (disclosures.has(mirrorKey) ? !section.collapsed : section.collapsed);
        if (!local) {
          if (!mirrors.has(mirrorKey)) {
            const wrapper = element('div'), heading = element('button', ({ projects: '项目', tasks: '聊天', pinned: '置顶' })[section.kind] || section.name);
            heading.style.cssText = 'text-align:left;padding:8px 14px;font:inherit;opacity:.65';
            heading.onclick = () => { if (disclosures.has(mirrorKey)) disclosures.delete(mirrorKey); else disclosures.add(mirrorKey); render(devices); };
            wrapper.append(heading); parent.append(wrapper); roots.set('mirror:' + mirrorKey, wrapper);
            mirrors.set(mirrorKey, { wrapper, collapsed });
          }
          mirrors.get(mirrorKey).wrapper.append(root);
        } else { local.node.parentElement.append(root); root.hidden = Boolean(collapsed); root.style.display = collapsed ? 'none' : 'flex'; }
        if (collapsed) continue;
        if (!section.itemKeys.length) { root.append(element('span', device.device.name + ' · 空分区')); root.lastChild.style.cssText = 'padding:3px 10px;font-size:11px;opacity:.5'; }
        function row(record, nested = false) {
          if (!record) return;
          const project = Array.isArray(record.conversationKeys), itemId = JSON.stringify([device.device.id, record.key]);
          const button = element('button'); button.setAttribute('data-codex-sidebar-item', record.key);
          button.style.cssText = 'display:flex;align-items:center;gap:6px;text-align:left;min-height:30px;width:100%;padding:4px ' + (nested ? '20' : '8') + 'px;font:inherit;color:inherit;border-radius:6px';
          button.title = (record.name || record.title) + '\n所属设备：' + device.device.name;
          button.append(element('span', project ? (disclosures.has(itemId) ? '▾' : '▸') : '·'));
          const label = element('span', record.name || record.title); label.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1'; button.append(label);
          const badge = element('span', device.device.name + (device.status === 'connected' ? '' : ' · 离线')); badge.style.cssText = 'font-size:10px;opacity:.5;white-space:nowrap'; button.append(badge);
          button.oncontextmenu = event => { event.preventDefault(); onItem(device, section, record); };
          button.onkeydown = event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); onItem(device, section, record); } };
          button.onclick = () => {
            if (project) { if (disclosures.has(itemId)) disclosures.delete(itemId); else disclosures.add(itemId); render(devices); }
            else if (device.status === 'connected' && record.source === 'codex') openConversation(device, record);
            else onItem(device, section, record);
          };
          root.append(button);
          if (project && disclosures.has(itemId)) {
            for (const child of record.conversationKeys) row(records.get(child), true);
            if (!record.conversationKeys.length) { const empty = element('span', record.childrenLoaded ? '暂无已载入会话' : '在所属设备打开以查看会话'); empty.style.cssText = 'padding:4px 22px;opacity:.5;font-size:11px'; root.append(empty); }
          }
        }
        for (const key of section.itemKeys) row(records.get(key));
        if (section.hiddenItemCount) root.append(element('span', '另有 ' + section.hiddenItemCount + ' 个原生条目暂不支持显示'));
      }
    }
  }
  return { render, clear, connected: () => [...roots.values()].every(root => root.isConnected), place() { for (const root of roots.values()) { const section = root.parentElement?.querySelector(':scope > section[data-app-action-sidebar-section-heading]'); if (section) { root.hidden = section.getAttribute('data-app-action-sidebar-section-collapsed') === 'true'; root.style.display = root.hidden ? 'none' : 'flex'; } } } };
}
