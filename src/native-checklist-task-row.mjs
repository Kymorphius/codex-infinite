export function createNativeChecklistTaskRow({ item, project, version, renderVersion, dialog, loaded, generalItems, items, make, createTaskEditor, drafts, taskEditors, view, act, appendAssignmentControl, appendTime, searchRegister, setError, newThreadClaim }) {
  const row = make('li'), check = make('input'), text = make('textarea'), remove = make('button', '删除');
  row.setAttribute('data-checklist-row', ''); row.dataset.done = String(item.done); check.type = 'checkbox'; check.checked = item.done; check.setAttribute('aria-label', '完成：' + item.text);
  row.dataset.checklistTaskId = item.id;
  const disabled = loaded !== project.key || item.readOnly === true;
  check.disabled = text.disabled = remove.disabled = disabled;
  if (item.readOnly) row.title = item.attachmentError || '来源设备未连接，任务只读';
  const projectKey = project.key, targetThreadId = project.claimThreadId, newThread = Boolean(project.claimNewThread), taskId = item.id;
  const isCurrent = () => !disabled && dialog.open && version === renderVersion() && project?.key === projectKey && project.claimThreadId === targetThreadId && Boolean(project.claimNewThread) === newThread && loaded === projectKey;
  const editor = createTaskEditor({ text, item, draft: drafts.get(taskId), disabled,
    readCurrent: expectedText => isCurrent() && view(projectKey, project.general ? generalItems() : items()).find(value => value.id === taskId && value.text === expectedText && value.done === item.done && value.assignedThreadId === item.assignedThreadId),
    onSave: current => act('upsert', current, projectKey, false), onError: message => { if (isCurrent()) setError(message); }
  });
  taskEditors.set(taskId, editor);
  if (project.claimThreadId || project.claimNewThread) {
    row.setAttribute('data-checklist-claim-row', '');
    const claim = make('button', '领取'); claim.type = 'button'; claim.disabled = disabled;
    let recoverable = false;
    if (project.claimNewThread && item.deliveryReservation && item.sourceConnected) {
      try { const receipt = JSON.parse(localStorage.getItem('ccc.checklist.new-thread.v1:' + item.id) || 'null'); recoverable = ['verifying', 'releasing'].includes(receipt?.phase) && receipt.requestId === item.deliveryReservation.requestId; } catch {}
      if (recoverable) { claim.textContent = '继续领取'; claim.disabled = false; }
    }
    claim.title = project.claimNewThread ? '把当前框内的内容放入新任务输入框并发送，创建新会话' : '领取当前框内的内容到会话待办，保持暂停，不自动发送';
    if (project.claimNewThread && item.input?.some(part => part.type === 'heldImage')) { claim.disabled = true; claim.title = '带图任务请选择已有会话'; }
    claim.addEventListener('pointerdown', event => event.preventDefault());
    claim.addEventListener('click', () => {
      if (project.claimNewThread) void newThreadClaim.claim(taskId, recoverable ? () => item : editor.read);
      else { const current = editor.read(); if (current) act('upsert', { ...current, assignedThreadId: targetThreadId }, projectKey); }
    });
    row.append(text, claim);
  } else {
    check.addEventListener('change', () => { const current = editor.read(); if (current) act('upsert', { ...current, done: check.checked }, projectKey); });
    remove.addEventListener('click', () => { const current = editor.current(); if (current) act('delete', current, projectKey); }); row.append(check, text);
    if (project.general) appendAssignmentControl(row, item, '指派会话', editor.read);
    row.append(remove);
  }
  appendTime(row, item); searchRegister(row, () => text.value); editor.restoreFocus();
  return { row, editor };
}
