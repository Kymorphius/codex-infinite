export function createNativeTerminalActions({ documentRef, windowRef, request, accept, readModel }) {
  let dialog = null;
  function notice(text) {
    const node = documentRef.createElement('div'); node.textContent = text; node.setAttribute('role', 'status');
    node.style.cssText = 'position:fixed;z-index:2147483647;bottom:28px;left:50%;transform:translateX(-50%);padding:10px 14px;border-radius:10px;background:var(--color-surface-elevated,var(--color-surface,#252525));color:var(--color-text-primary,#eee);font:13px system-ui';
    documentRef.body.append(node); setTimeout(() => node.remove(), 4000);
  }
  async function update(record, fields) {
    try { const result = await request('update', { id: record.id, expectedRevision: record.revision, ...fields }); accept(result.conversation); return true; }
    catch (error) { notice(error.message || '保存失败，请刷新后重试'); return false; }
  }
  function rename(record) {
    dialog?.remove(); dialog = documentRef.createElement('dialog'); dialog.setAttribute('aria-label', '重命名会话');
    dialog.style.cssText = 'padding:20px;border:1px solid #8885;border-radius:14px;background:var(--color-surface-elevated,var(--color-surface,#252525));color:var(--color-text-primary,#eee);min-width:320px';
    const form = documentRef.createElement('form'), title = documentRef.createElement('h3'), input = documentRef.createElement('input'), save = documentRef.createElement('button'), cancel = documentRef.createElement('button');
    title.textContent = '重命名会话'; input.value = record.title; input.maxLength = 160; input.required = true; input.setAttribute('aria-label', '会话名称'); input.style.cssText = 'display:block;width:100%;padding:8px;margin:12px 0;color:inherit;background:transparent;border:1px solid #8887;border-radius:6px';
    save.type = 'submit'; save.textContent = '保存'; cancel.type = 'button'; cancel.textContent = '取消'; cancel.onclick = () => dialog?.close();
    form.append(title, input, save, cancel); dialog.append(form); documentRef.body.append(dialog); dialog.showModal(); input.focus(); input.select();
    form.onsubmit = async event => { event.preventDefault(); if (!input.value.trim()) return; save.disabled = true; if (await update(record, { title: input.value.trim() })) dialog?.close(); save.disabled = false; };
    dialog.addEventListener('keydown', event => event.stopPropagation());
  }
  async function menu(record) {
    try {
      const result = await windowRef.electronBridge?.showContextMenu?.([
        { id: 'rename', label: '重命名', enabled: true }, { id: 'pin', label: record.pinned ? '取消置顶' : '置顶', enabled: true },
        { id: 'archive', label: '归档', enabled: true }, { type: 'separator' },
        { id: 'runtime', label: record.status === 'running' ? '停止终端进程' : '启动会话', enabled: true }
      ]);
      if (result?.id === 'rename') rename(record);
      else if (result?.id === 'pin') await update(record, { pinned: !record.pinned });
      else if (result?.id === 'archive') await update(record, { archived: true });
      else if (result?.id === 'runtime') accept((await request(record.status === 'running' ? 'stop' : 'start', { id: record.id })).conversation);
    } catch (error) { notice(error.message || '会话操作失败'); }
  }
  // Creates and starts a conversation in a local project directory; `open: false` leaves the
  // current view alone (a discussion being assembled). Returns the conversation, or throws.
  async function createRecord(project, cwd, kind, { open = true } = {}) {
    if (!project || project.cloud || (project.hostId && project.hostId !== 'local') || project.device?.kind === 'remote-codex' || !project.sourceDirectories?.includes(cwd)) throw Error('请选择本机项目的明确目录');
    const model = readModel(documentRef), id = project.key || project.id;
    const entry = [...model.projectByKey].find(([, value]) => value.group?.projectId === id && (value.group?.hostId || 'local') === 'local');
    if (!entry) throw Error('项目还未就绪，请刷新项目后重试');
    const result = await request('create', { cwd, kind, projectRef: { source: 'codex', key: entry[0], id, hostId: 'local' } });
    accept(result.conversation); if (open) windowRef.__codexControlConsoleOpenTerminalConversation?.(result.conversation);
    return result.conversation;
  }
  async function create(project, cwd, kind) {
    try {
      if (!project || project.cloud || (project.hostId && project.hostId !== 'local') || project.device?.kind === 'remote-codex' || !project.sourceDirectories?.includes(cwd)) throw Error('请选择本机项目的明确目录');
      const model = readModel(documentRef), id = project.key || project.id;
      const entry = [...model.projectByKey].find(([, value]) => value.group?.projectId === id && (value.group?.hostId || 'local') === 'local');
      if (!entry) throw Error('项目还未就绪，请刷新项目后重试');
      const result = await request('create', { cwd, kind, projectRef: { source: 'codex', key: entry[0], id, hostId: 'local' } });
      accept(result.conversation); windowRef.__codexControlConsoleOpenTerminalConversation?.(result.conversation);
      return true;
    } catch (error) { notice(error.message || '无法创建会话'); return false; }
  }
  // A new Claude conversation in the same directory and project; the source stays untouched.
  async function fresh(record) {
    try {
      if (record?.kind !== 'claude') throw Error('只有 Claude CLI 会话支持');
      const result = await request('create', { cwd: record.cwd, kind: 'claude', projectRef: record.projectRef || null });
      accept(result.conversation); windowRef.__codexControlConsoleOpenTerminalConversation?.(result.conversation);
      return { ok: true };
    } catch (error) { return { ok: false, message: error.message || '无法创建新会话' }; }
  }
  return { menu, create, createRecord, fresh, notice, destroy() { dialog?.remove(); } };
}
