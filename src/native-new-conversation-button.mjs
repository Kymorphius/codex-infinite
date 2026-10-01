// "新建" beside 最近发送: a two-item menu (GPT / Claude CLI) that starts a fresh conversation
// of the chosen kind in the active conversation's project, whichever kind the active one is.
// Claude in a project with several directories first lists them to pick the working one.
export function installNativeNewConversationButton({ documentRef, root, activeTab }) {
  const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  const svg = (name) => documentRef.createElementNS('http://www.w3.org/2000/svg', name);
  const host = documentRef.createElement('div');
  host.className = 'ccc-native-recent ccc-native-new';
  const button = documentRef.createElement('button');
  button.type = 'button';
  button.className = 'ccc-native-recent-trigger';
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');
  const icon = svg('svg');
  for (const [key, value] of [['class', 'ccc-native-recent-icon'], ['aria-hidden', 'true'], ['viewBox', '0 0 24 24'], ['fill', 'none'], ['stroke', 'currentColor'], ['stroke-width', '1.8'], ['stroke-linecap', 'round'], ['stroke-linejoin', 'round']]) icon.setAttribute(key, value);
  const path = svg('path');
  path.setAttribute('d', 'M12 5v14M5 12h14');
  icon.append(path);
  const label = documentRef.createElement('span');
  label.textContent = '新建';
  button.append(icon, label);
  const menu = documentRef.createElement('div');
  menu.className = 'ccc-native-recent-menu ccc-native-new-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', '新建会话');
  menu.hidden = true;
  host.append(button, menu);
  root.append(host);

  const notify = (message) => {
    const node = documentRef.createElement('div');
    node.textContent = message; node.setAttribute('role', 'status');
    node.style.cssText = 'position:fixed;z-index:2147483647;bottom:28px;left:50%;transform:translateX(-50%);padding:8px 12px;border-radius:8px;background:var(--color-surface-elevated,var(--color-surface,#252525));color:var(--color-text);font:13px/20px -apple-system,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.28)';
    documentRef.body.append(node); setTimeout(() => node.remove(), 3000);
  };
  const close = ({ focus = false } = {}) => {
    menu.hidden = true; button.setAttribute('aria-expanded', 'false');
    if (menu.children[0] && !menu.children[0].dataset.newTarget) showBase();
    if (focus) button.focus();
  };
  const sourceOf = (tab) => tab?.kind === 'local' && UUID.test(tab.id || '') ? 'codex' : tab?.kind === 'terminal' && tab.engine === 'claude' ? 'claude' : '';
  const update = () => {
    const source = sourceOf(activeTab());
    const text = source ? '在当前会话所属项目新建 GPT 或 Claude CLI 会话' : '打开一个 GPT 或 Claude 会话后可在其项目中新建';
    if (button.disabled !== !source) button.disabled = !source;
    if (!source && !menu.hidden) close();
    if (button.title !== text) { button.title = text; button.setAttribute('aria-label', '新建：' + text); }
  };

  // Project of the active conversation, as the search catalog knows it (`create` and the
  // path menu take catalog projects). A Codex task falls back to its sidebar project row.
  const search = () => window.__codexControlConsoleProjectSearch;
  const codexProject = (tab) => {
    const found = search()?.projectOfTask?.(tab.id);
    if (found) return found;
    const row = documentRef.querySelector('[data-app-action-sidebar-thread-id="local:' + tab.id + '"],[data-app-action-sidebar-thread-id="' + tab.id + '"]');
    const listId = row?.closest?.('[data-app-action-sidebar-project-list-id]')?.getAttribute('data-app-action-sidebar-project-list-id') || '';
    return listId ? { id: listId.replace(/^local-/, '') } : null;
  };
  // Where a new Claude conversation may start. A project with several directories asks which
  // one; the current Claude conversation's directory is marked and keeps its project link.
  function claudePlan() {
    const tab = activeTab(), source = sourceOf(tab), terminals = window.__cccTerminalConversations;
    const record = source === 'claude' ? terminals?.records?.().find((item) => item.id === tab.id) : null;
    if (source === 'claude' && !record) return { error: '找不到当前 Claude 会话' };
    const project = source === 'claude' ? search()?.projectOfDirectory?.(record.cwd) : codexProject(tab);
    const roots = [...new Set((Array.isArray(project?.sourceDirectories) ? project.sourceDirectories : []).filter((value) => typeof value === 'string' && value))];
    return { source, record, project, roots };
  }
  async function startClaude(plan, directory) {
    const terminals = window.__cccTerminalConversations;
    if (plan.record && (!directory || directory === plan.record.cwd)) {
      if (!terminals?.fresh) return notify('找不到当前 Claude 会话');
      const result = await terminals.fresh(plan.record);
      if (!result.ok) notify(result.message);
      return;
    }
    if (!plan.project) return notify('找不到当前会话所属项目，请先在项目中展开它');
    const cwd = directory || (plan.roots.length === 1 ? plan.roots[0] : '');
    if (!cwd || !terminals?.create) return notify('找不到项目目录，无法新建 Claude 会话');
    await terminals.create(plan.project, cwd, 'claude');
  }
  async function start(target) {
    const tab = activeTab(), source = sourceOf(tab);
    if (!source) return;
    if (target === 'claude') {
      const plan = claudePlan();
      return plan.error ? notify(plan.error) : startClaude(plan);
    }
    const terminals = window.__cccTerminalConversations;
    const record = source === 'claude' ? terminals?.records?.().find((item) => item.id === tab.id) : null;
    if (source === 'claude' && !record) return notify('找不到当前 Claude 会话');
    const project = source === 'claude' ? search()?.projectOfDirectory?.(record.cwd) : codexProject(tab);
    if (!project) return notify('找不到当前会话所属项目，请先在项目中展开它');
    if (!window.__cccProjectSearchActions?.create) return notify('原生新建入口尚未就绪');
    await window.__cccProjectSearchActions.create(project);
  }
  let busy = false;
  const run = async (task) => {
    close();
    if (busy) return;
    busy = true;
    try { await task(); } finally { busy = false; }
  };
  const entry = (title, detail, onClick) => {
    const node = documentRef.createElement('button');
    node.type = 'button';
    node.className = 'ccc-native-recent-select';
    node.setAttribute('role', 'menuitem');
    const copy = documentRef.createElement('span');
    copy.className = 'ccc-native-recent-copy';
    const name = documentRef.createElement('span');
    name.className = 'ccc-native-recent-title'; name.textContent = title;
    copy.append(name);
    if (detail) {
      const note = documentRef.createElement('span');
      note.className = 'ccc-native-recent-detail'; note.textContent = detail;
      copy.append(note);
    }
    node.append(copy);
    node.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); return onClick(); });
    return node;
  };
  const clear = () => { while (menu.children.length) menu.children[0].remove(); };
  const item = (target, title, detail) => {
    const node = entry(title, detail, () => {
      if (target === 'claude' && !busy) {
        const plan = claudePlan();
        if (!plan.error && plan.roots.length > 1) return showDirectories(plan);
      }
      return run(() => start(target));
    });
    node.dataset.newTarget = target;
    return node;
  };
  const baseItems = [item('codex', 'GPT 会话', '在此项目新建原生 Codex 会话'), item('claude', 'Claude CLI 会话', '在此项目新建终端里的 Claude')];
  const showBase = () => { clear(); menu.append(...baseItems); };
  function showDirectories(plan) {
    clear();
    const current = plan.record?.cwd || '';
    const ordered = current && plan.roots.includes(current) ? [current, ...plan.roots.filter((value) => value !== current)] : plan.roots;
    for (const directory of ordered) {
      const name = directory.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || directory;
      const node = entry(name + (directory === current ? '（当前会话目录）' : ''), directory, () => run(() => startClaude(plan, directory)));
      node.dataset.newDirectory = directory; node.title = directory;
      menu.append(node);
    }
    const back = entry('返回', '', showBase);
    back.dataset.newBack = 'true';
    menu.append(back);
    menu.children[0]?.focus?.({ preventScroll: true });
  }
  showBase();
  button.addEventListener('click', (event) => {
    event.preventDefault(); event.stopPropagation();
    if (button.disabled) return;
    if (!menu.hidden) return close();
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    menu.children[0]?.focus?.({ preventScroll: true });
  });
  const outside = (event) => { if (!menu.hidden && !host.contains(event.target)) close(); };
  const keyboard = (event) => { if (!menu.hidden && event.key === 'Escape') { event.preventDefault(); close({ focus: true }); } };
  documentRef.addEventListener('pointerdown', outside, true);
  documentRef.addEventListener('keydown', keyboard, true);
  update();
  return {
    update,
    close,
    destroy() {
      documentRef.removeEventListener('pointerdown', outside, true);
      documentRef.removeEventListener('keydown', keyboard, true);
      host.remove();
    }
  };
}

export const NATIVE_NEW_CONVERSATION_STYLE = '.ccc-native-recent-trigger:disabled{opacity:.4;cursor:default;background:transparent}.ccc-native-new-menu{width:auto;min-width:230px;max-width:min(460px,calc(100vw - 24px))}';
