// Live native React model access is confined to this adapter. Never mutate props.
export function readNativeSidebarModel(document) {
  const sections = [], projectByKey = new Map(), conversationByKey = new Map(), scopes = new Set();
  const nodes = Array.from(document.querySelectorAll('section[data-app-action-sidebar-section-heading]')).slice(0, 128);
  const wanted = new Set(nodes), committed = new Map();
  const owned = nodes.find(node => Object.keys(node).some(key => key.startsWith('__reactFiber')));
  let root = owned?.[Object.keys(owned).find(key => key.startsWith('__reactFiber'))];
  while (root?.return) root = root.return;
  const queue = [root?.stateNode?.current || root];
  for (let count = 0; queue.length && count < 100000; count++) {
    const fiber = queue.pop(); if (!fiber) continue;
    if (wanted.has(fiber.stateNode)) committed.set(fiber.stateNode, fiber);
    if (fiber.sibling) queue.push(fiber.sibling); if (fiber.child) queue.push(fiber.child);
  }
  const fiberFor = node => committed.get(node);
  function listProps(children) {
    const queue = [children];
    for (let count = 0; queue.length && count < 256; count++) {
      const child = queue.shift();
      if (Array.isArray(child)) { queue.push(...child); continue; }
      if (child?.props?.projectByKey instanceof Map && child.props.conversationByKey instanceof Map) return child.props;
      if (child?.props?.children) queue.push(child.props.children);
    }
    return null;
  }
  for (const node of nodes) {
    let fiber = fiberFor(node), native = null;
    for (let depth = 0; fiber && depth < 30; depth++, fiber = fiber.return) {
      const props = fiber.memoizedProps;
      if (!native && typeof props?.sectionKey === 'string' && typeof props.onCollapsedChange === 'function') native = props;
      if (!native) continue;
      for (const value of (fiber.updateQueue?.memoCache?.data || []).flat()) {
        if (value && typeof value.get === 'function' && typeof value.set === 'function' && value.query && value.scope && value.node) scopes.add(value);
      }
      if (Object.hasOwn(props || {}, 'catalogSourcesReady')) break;
    }
    if (!native || sections.some(section => section.id === native.sectionKey)) continue;
    const list = listProps(native.children);
    if (!list && !native.sectionKey.startsWith('custom:')) continue;
    if (list) {
      for (const [key, value] of list.projectByKey) projectByKey.set(key, value);
      for (const [key, value] of list.conversationByKey) conversationByKey.set(key, value);
    }
    const id = native.sectionKey;
    sections.push({ id, name: native.heading || native.label || id,
      kind: id === 'threads' ? 'projects' : id === 'pinned' ? 'pinned' : id === 'chats' ? 'tasks' : 'custom',
      collapsed: Boolean(native.collapsed), itemKeys: Array.isArray(list?.keys) ? [...list.keys] : [],
      node, native, list });
  }
  if (!sections.some(section => section.id === 'threads')) throw Error('原生侧边栏尚未就绪');
  const first = [...scopes][0];
  const scope = first && [...scopes].every(value => value.node === first.node && value.scope === first.scope) ? first : null;
  return { sections, projectByKey, conversationByKey, scope };
}

export function projectNativeSidebarModel(model) {
  const clean = (value, max = 160) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '';
  const conversations = new Map(), projects = [];
  function conversation(key, value) {
    if (conversations.has(key)) return conversations.get(key);
    const source = value?.source === 'chatgpt' || key.startsWith('chatgpt:') ? 'chatgpt' : 'codex';
    const nativeKey = value?.threadKey || key.slice('codex:thread:'.length);
    const target = value?.target;
    const id = source === 'chatgpt' ? target?.conversationId || key.slice('chatgpt:conversation:'.length)
      : nativeKey.startsWith('local:') ? nativeKey.slice(6) : nativeKey.startsWith('remote:') ? nativeKey.slice(7) : nativeKey;
    const item = { key: clean(key, 260), id: clean(id), source, title: clean(target?.conversation?.title || target?.title),
      hostId: clean(value?.hostId || target?.hostId || 'local'), route: clean(target?.route, 500) || null };
    conversations.set(key, item); return item;
  }
  for (const [key, value] of model.conversationByKey) conversation(key, value);
  for (const [key, value] of model.projectByKey) {
    const group = value?.group, source = value?.source === 'chatgpt' ? 'chatgpt' : 'codex';
    const threadKeys = group?.threadKeys || value?.localThreadKeys || [];
    const conversationKeys = threadKeys.slice(0, 2048).map(key => {
      const nativeKey = 'codex:thread:' + key;
      conversation(nativeKey, { source: 'codex', threadKey: key, hostId: group?.hostId }); return nativeKey;
    });
    projects.push({ key: clean(key, 260), id: clean(group?.projectId || value?.project?.gizmo?.id), source,
      name: clean(group?.label || value?.project?.gizmo?.display?.name) || '未命名项目',
      hostId: clean(group?.hostId || 'local'), sourceDirectories: (group?.rootPaths || (group?.path ? [group.path] : [])).slice(0, 64).map(path => clean(path, 1024)),
      conversationKeys, childrenLoaded: source === 'codex' });
  }
  const allowed = new Set([...projects.map(item => item.key), ...conversations.keys()]);
  return { schemaVersion: 1,
    sections: [...(model.sections.some(section => section.id === 'pinned') ? [] : [{ id: 'pinned', name: 'Pinned', kind: 'pinned', collapsed: true, itemKeys: [] }]), ...model.sections].map(({ id, name, kind, collapsed, itemKeys }) => ({ id: clean(id, 200), name: clean(name, 100), kind, collapsed,
      itemKeys: itemKeys.filter(key => allowed.has(key)).slice(0, 8192), hiddenItemCount: itemKeys.filter(key => !allowed.has(key)).length })),
    projects: projects.slice(0, 1024), conversations: [...conversations.values()].slice(0, 8192) };
}

export function buildNativeSidebarReadScript() {
  return `(${projectNativeSidebarModel.toString()})((${readNativeSidebarModel.toString()})(document))`;
}
