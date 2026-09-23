export function createNativeChecklistTaskModel({ generalKey, heldKey, syncBinding, documentRef, localStorageRef, windowRef, normalizeInput, readThreadId, readGeneralItems, readPending, enqueueAction, setAssignedSnapshot, onSaved }) {
  const notify = () => { try { windowRef[syncBinding]?.('save'); } catch { /* periodic sync remains the recovery path */ } };
  function enqueueTask(item, projectKey = generalKey, signal = true) {
    if (!enqueueAction(item, projectKey)) return false;
    if (signal) notify();
    onSaved(projectKey);
    return true;
  }
  function removeLegacyDraft(source, expectedInput) {
    try {
      const value = JSON.parse(localStorageRef.getItem(heldKey) || '{}'), records = Array.isArray(value?.[source.threadId]) ? value[source.threadId] : [];
      const next = records.filter(item => !(item?.id === source.id && item.origin === (source.origin || 'draft') && item.heldAt === source.heldAt && JSON.stringify(item.input) === JSON.stringify(expectedInput)));
      if (next.length === records.length) return false;
      value[source.threadId] = next; localStorageRef.setItem(heldKey, JSON.stringify(value));
      windowRef.dispatchEvent(new windowRef.Event('codex-control-console-held-todos-changed')); return true;
    } catch { return false; }
  }
  function hasLegacyDrafts() {
    try {
      const stored = JSON.parse(localStorageRef.getItem(heldKey) || '{}'), pending = readPending();
      return Object.entries(stored || {}).some(([threadId, records]) => Array.isArray(records) && records.some(item => ['draft', 'paused-queue'].includes(item?.origin) && !pending.some(action => action.legacyHeldSource?.id === item.id && action.legacyHeldSource?.threadId === threadId)));
    } catch { return false; }
  }
  function migrateLegacyDrafts(signal = false) {
    let stored;
    try { stored = JSON.parse(localStorageRef.getItem(heldKey) || '{}'); }
    catch { return '旧版待办无法读取，原数据已保留'; }
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return '';
    let migrated = 0, warning = '';
    for (const [threadId, records] of Object.entries(stored)) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(threadId) || !Array.isArray(records)) continue;
      for (const legacy of records) {
        if (!['draft', 'paused-queue'].includes(legacy?.origin) || !Number.isFinite(legacy.heldAt) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(legacy.id || '')) continue;
        const source = { id: legacy.id, threadId, heldAt: legacy.heldAt, origin: legacy.origin }, pending = readPending();
        if (pending.some(action => action.legacyHeldSource?.id === source.id && action.legacyHeldSource?.threadId === threadId)) continue;
        const existing = readGeneralItems().find(item => item.id === legacy.id);
        if (existing) {
          if (existing.assignedThreadId === threadId && JSON.stringify(existing.input) === JSON.stringify(legacy.input)) removeLegacyDraft(source, legacy.input);
          else warning = warning || '旧待办与任务清单中的同 ID 任务不一致，已保留原数据';
          continue;
        }
        try {
          const input = normalizeInput(legacy.input), text = input.find(part => part.type === 'text')?.text || String(legacy.summary || '图片待办').slice(0, 5000);
          if (!enqueueTask({ id: legacy.id, text, done: false, assignedThreadId: threadId, input, createdAt: new Date(legacy.heldAt).toISOString(), legacyHeldSource: source }, generalKey, false)) return '旧待办迁移暂未保存，原待办仍保留';
          migrated++;
          if (migrated >= 20) { if (signal) notify(); return warning || ''; }
        } catch { warning = warning || '有旧待办无法安全迁移，原数据已保留'; }
      }
    }
    if (signal && migrated) notify(); return warning;
  }
  function createAssignedTask(value) {
    if (!value || value.threadId !== readThreadId(documentRef) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.id || '') || typeof value.text !== 'string' || !value.text.trim()) throw new Error('任务归属或内容无效');
    const input = normalizeInput(value.input), existing = [...readGeneralItems(), ...readPending().filter(action => action.projectKey === generalKey && action.type !== 'delete')].find(item => item.id === value.id);
    if (existing) {
      if (existing.assignedThreadId === value.threadId && existing.text === value.text && JSON.stringify(existing.input) === JSON.stringify(input)) return true;
      throw new Error('任务标识冲突，未覆盖现有任务');
    }
    if (!enqueueTask({ ...value, text: value.text.trim(), done: false, assignedThreadId: value.threadId, input }, generalKey)) throw new Error('任务尚未安全保存');
    setAssignedSnapshot({ threadId: value.threadId, items: tasksForThread(value.threadId) });
    return true;
  }
  function tasksForThread(threadId) {
    const normalized = String(threadId || '').toLowerCase(), items = new Map(readGeneralItems().map(item => [item.id, item]));
    for (const action of readPending().filter(value => value.projectKey === generalKey)) {
      if (action.type === 'delete') items.delete(action.id);
      else items.set(action.id, { ...items.get(action.id), ...action });
    }
    return [...items.values()].filter(item => !item.done && String(item.assignedThreadId || '').toLowerCase() === normalized)
      .map(item => ({ id: item.id, text: item.text, ...(typeof item.createdAt === 'string' ? { createdAt: item.createdAt } : {}), ...(Array.isArray(item.input) ? { input: item.input } : {}) }));
  }
  function completeLegacySources(actions) {
    for (const action of actions) if (action.legacyHeldSource) removeLegacyDraft(action.legacyHeldSource, action.input);
  }
  const legacyTaskPending = (id, threadId) => readPending().some(action => action.legacyHeldSource?.id === id && action.legacyHeldSource?.threadId === threadId);
  return { enqueueTask, removeLegacyDraft, hasLegacyDrafts, migrateLegacyDrafts, createAssignedTask, tasksForThread, completeLegacySources, legacyTaskPending };
}

export function createNativeChecklistPasteImages({ taskImages, cryptoRef, onError, onChange }) {
  let images = [], busy = false, generation = 0;
  async function discard() { generation++; const previous = images; images = []; onChange(); await taskImages.release(previous).catch(() => {}); }
  function bind(form) {
    async function paste(event) {
      const files = Array.from(event.clipboardData?.items || []).filter(item => /^image\//i.test(item.type || '')).map(item => item.getAsFile?.()).filter(Boolean);
      if (!files.length) return;
      event.preventDefault();
      if (images.length + files.length > 8) { onError('每项任务最多粘贴 8 张图片'); return; }
      const current = ++generation, id = cryptoRef.randomUUID(); busy = true; onChange();
      try {
        const saved = await taskImages.captureBlobs(files, id);
        if (current !== generation) { await taskImages.release(saved); return; }
        images.push(...saved);
      } catch (error) { if (current === generation) onError(error.message || '无法保存粘贴图片'); }
      finally { if (current === generation) { busy = false; onChange(); } }
    }
    form.addEventListener('paste', paste);
    return () => form.removeEventListener?.('paste', paste);
  }
  return {
    bind,
    images: () => images.slice(),
    busy: () => busy,
    render(status, add, ready) { status.hidden = !images.length; status.textContent = images.length ? `已附加 ${images.length} 张图片` : ''; add.disabled = busy || !ready; },
    consume() { images = []; generation++; onChange(); },
    discard
  };
}
