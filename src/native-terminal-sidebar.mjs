// Only provider-owned DOM is mounted. Native projects, ordering and rows are untouched.
export function nativeTerminalProjectList(documentRef, record) {
  const project = record?.projectRef;
  if (!project || project.source !== 'codex' || project.hostId !== 'local') return null;
  return [...documentRef.querySelectorAll('[data-app-action-sidebar-project-list-id]')].find(node => {
    const id = node.getAttribute('data-app-action-sidebar-project-list-id');
    return id === project.id || id === 'local-' + project.id;
  }) || null;
}

export function nativeTerminalProjectPlacement(documentRef, record) {
  const project = record?.projectRef;
  if (!project || project.source !== 'codex' || project.hostId !== 'local') return null;
  const row = [...documentRef.querySelectorAll('[data-app-action-sidebar-project-id]')].find(node => node.getAttribute('data-app-action-sidebar-project-id') === project.id);
  if (row?.getAttribute('data-app-action-sidebar-project-collapsed') === 'true') return null;
  const list = nativeTerminalProjectList(documentRef, record);
  if (list) return { parent: list, after: null };
  return row?.parentElement ? { parent: row.parentElement, after: row } : null;
}

export function createNativeTerminalSidebar({ documentRef, readModel, open, menu }) {
  const roots = new Map();
  const make = (tag, text) => { const node = documentRef.createElement(tag); if (text) node.textContent = text; return node; };
  const style = make('style'); style.textContent = '[data-ccc-terminal-sidebar]{display:flex;flex-direction:column;min-width:0;font:13px/20px system-ui;color:inherit}[data-ccc-terminal-sidebar-row]{display:flex;align-items:center;min-height:30px;border-radius:7px;padding:1px 5px;gap:3px}[data-ccc-terminal-sidebar-row]:hover{background:color-mix(in srgb,currentColor 7%,transparent)}[data-ccc-terminal-sidebar-row][data-selected="true"]{background:color-mix(in srgb,currentColor 11%,transparent)}[data-ccc-terminal-sidebar-row] button{background:none;border:0;color:inherit;font:inherit;cursor:pointer;padding:4px 5px}[data-ccc-terminal-sidebar-row] [data-terminal-open]{min-width:0;display:flex;align-items:center;gap:7px;flex:1;text-align:left}[data-ccc-terminal-sidebar-row] [data-terminal-title]{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}[data-terminal-engine]{font-size:10px;opacity:.55}[data-terminal-more]{opacity:.55}[data-ccc-terminal-fallback-heading]{padding:8px 10px;font-size:12px;opacity:.6}';
  documentRef.head.append(style);
  let signature = '', lastRecords = [], selected = '';
  function target(record, model) {
    if (!record.pinned && record.projectRef) return nativeTerminalProjectPlacement(documentRef, record);
    const kind = record.pinned ? 'pinned' : 'tasks';
    const section = model.sections.find(value => value.kind === kind);
    if (section) return section.collapsed ? null : { parent: section.node.parentElement };
    const parent = model.sections.find(value => value.kind === 'projects')?.node.parentElement?.parentElement;
    return parent ? { parent } : null;
  }
  function render(records = lastRecords, active = selected) {
    lastRecords = records; selected = active;
    let model; try { model = readModel(documentRef); } catch { return; }
    const visible = records.filter(record => !record.archived), next = JSON.stringify([visible, active]);
    const placements = visible.map(record => [record, target(record, model)]).filter(([, placement]) => placement?.parent);
    const expectedTails = new Map();
    const placed = placements.every(([record, placement]) => {
      const root = roots.get(record.id), tail = expectedTails.get(placement.after) || placement.after;
      if (!root || root.parentElement !== placement.parent || (tail && root.previousElementSibling !== tail)) return false;
      if (placement.after) expectedTails.set(placement.after, root);
      return true;
    });
    if (next === signature && placements.length === roots.size && placed) return;
    signature = next; for (const root of roots.values()) root.remove(); roots.clear();
    const headings = new Set(), tails = new Map();
    for (const [record, placement] of placements) {
      const { parent, after } = placement;
      const root = make('div'); root.dataset.cccTerminalSidebar = record.id;
      const kind = record.pinned ? 'pinned' : !record.projectRef ? 'tasks' : null;
      if (kind && !model.sections.some(section => section.kind === kind) && !headings.has(kind)) {
        const heading = make('div', kind === 'pinned' ? '置顶' : '任务'); heading.dataset.cccTerminalFallbackHeading = ''; root.append(heading); headings.add(kind);
      }
      root.addEventListener('pointerdown', event => event.stopPropagation());
      root.addEventListener('dragstart', event => { event.preventDefault(); event.stopPropagation(); });
      const row = make('div'); row.dataset.cccTerminalSidebarRow = record.id; row.dataset.selected = String(record.id === active);
      const button = make('button'); button.type = 'button'; button.dataset.terminalOpen = ''; button.title = record.title + '\n' + record.cwd;
      const label = make('span', record.title); label.dataset.terminalTitle = '';
      const engine = make('span', record.kind === 'claude' ? 'Claude' : 'Shell'); engine.dataset.terminalEngine = '';
      button.append(make('span', record.kind === 'claude' ? '◇' : '›_'), label, engine);
      button.onclick = () => open(record);
      const more = make('button', '···'); more.type = 'button'; more.dataset.terminalMore = ''; more.setAttribute('aria-label', '会话操作：' + record.title); more.onclick = () => menu(record);
      row.oncontextmenu = event => { event.preventDefault(); event.stopPropagation(); menu(record); };
      row.onkeydown = event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); menu(record); } };
      row.append(button, more); root.append(row);
      if (after) { const tail = tails.get(after) || after; parent.insertBefore(root, tail.nextSibling); tails.set(after, root); }
      else parent.append(root);
      roots.set(record.id, root);
    }
  }
  return { render, destroy() { for (const root of roots.values()) root.remove(); roots.clear(); style.remove(); } };
}
