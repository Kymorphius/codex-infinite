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

// A Router companion Claude session sits directly under its Codex conversation: after the
// thread row's outermost single-child wrapper (the list item). Hidden when the row is not rendered.
export function nativeCompanionPlacement(documentRef, record) {
  if (!record?.companionOf) return null;
  let item = documentRef.querySelector('[data-app-action-sidebar-thread-id="local:' + record.companionOf + '"]');
  if (!item) return null;
  while (item.parentElement && item.parentElement.children.length === 1) item = item.parentElement;
  return item.parentElement ? { parent: item.parentElement, after: item } : null;
}

export function createNativeTerminalSidebar({ documentRef, readModel, open, menu }) {
  const roots = new Map();
  const make = (tag, text) => { const node = documentRef.createElement(tag); if (text) node.textContent = text; return node; };
  const style = make('style'); style.textContent = '[data-ccc-terminal-sidebar]{display:flex;flex-direction:column;min-width:0;font:13px/20px system-ui;color:inherit}[data-ccc-terminal-sidebar-row]{display:flex;align-items:center;min-height:30px;border-radius:7px;padding:1px 5px;gap:3px}[data-ccc-terminal-sidebar-row]:hover{background:color-mix(in srgb,currentColor 7%,transparent)}[data-ccc-terminal-sidebar-row][data-selected="true"]{background:color-mix(in srgb,currentColor 11%,transparent)}[data-ccc-terminal-sidebar-row] button{background:none;border:0;color:inherit;font:inherit;cursor:pointer;padding:4px 5px}[data-ccc-terminal-sidebar-row] [data-terminal-open]{min-width:0;display:flex;align-items:center;gap:7px;flex:1;text-align:left}[data-ccc-terminal-sidebar-row] [data-terminal-title]{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}[data-terminal-glyph]{width:16px;text-align:center;font:600 11px/1 ui-monospace,Menlo,monospace;opacity:.7}[data-terminal-engine]{flex:0 0 auto;display:inline-flex;align-items:center;gap:4px;padding:0 6px;border-radius:999px;font-size:10px;line-height:16px;color:#d9a640;background:color-mix(in srgb,#d9a640 14%,transparent)}[data-terminal-engine="shell"]{color:#8fb6ea;background:color-mix(in srgb,#8fb6ea 14%,transparent)}[data-terminal-engine][data-running="true"]::before{content:"";width:5px;height:5px;border-radius:50%;background:#3fb27f}[data-terminal-more]{opacity:.55}[data-ccc-terminal-fallback-heading]{padding:8px 10px;font-size:12px;opacity:.6}[data-ccc-terminal-sidebar-row][data-companion="true"]{padding-left:22px;min-height:26px;font-size:12px}[data-ccc-terminal-sidebar-row][data-companion="true"] [data-terminal-glyph]{opacity:.5}';
  documentRef.head.append(style);
  let signature = '', lastRecords = [], selected = '';
  function target(record, model) {
    if (record.companionOf) return nativeCompanionPlacement(documentRef, record);
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
      const companion = Boolean(record.companionOf); row.dataset.companion = String(companion);
      const button = make('button'); button.type = 'button'; button.dataset.terminalOpen = '';
      button.title = companion ? '伴生 Claude CLI 会话：' + record.title + '\n' + (record.occupiedBy === 'codex' ? 'Codex 正在用它回复，本轮结束后可打开' : '打开后与 Codex 轮流使用同一上下文') : record.title + '\n' + record.cwd;
      const label = make('span', record.title); label.dataset.terminalTitle = '';
      const engine = make('span', companion && record.occupiedBy === 'codex' ? 'Codex 回复中' : record.kind === 'claude' ? 'CLI' : 'Shell'); engine.dataset.terminalEngine = record.kind === 'claude' ? 'claude' : 'shell';
      engine.dataset.running = String(record.status === 'running');
      const glyph = make('span', companion ? '↳' : record.kind === 'claude' ? '◇' : '›_'); glyph.dataset.terminalGlyph = '';
      button.append(glyph, label, engine);
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
