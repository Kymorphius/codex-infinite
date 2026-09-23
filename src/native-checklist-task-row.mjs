export function createNativeChecklistTaskRow({ item, project, version, renderVersion, dialog, loaded, generalItems, items, make, createTaskEditor, drafts, taskEditors, view, act, appendAssignmentControl, appendTime, searchRegister, setError, newThreadClaim }) {
  const row = make('li'), check = make('input'), text = make('textarea'), remove = make('button', '删除');
  row.setAttribute('data-checklist-row', ''); row.dataset.done = String(item.done); check.type = 'checkbox'; check.checked = item.done; check.setAttribute('aria-label', '完成：' + item.text);
  check.disabled = text.disabled = remove.disabled = loaded !== project.key;
  const projectKey = project.key, targetThreadId = project.claimThreadId, newThread = Boolean(project.claimNewThread), taskId = item.id;
  const isCurrent = () => dialog.open && version === renderVersion() && project?.key === projectKey && project.claimThreadId === targetThreadId && Boolean(project.claimNewThread) === newThread && loaded === projectKey;
  const editor = createTaskEditor({ text, item, draft: drafts.get(taskId), disabled: loaded !== projectKey,
    readCurrent: expectedText => isCurrent() && view(projectKey, project.general ? generalItems() : items()).find(value => value.id === taskId && value.text === expectedText && value.done === item.done && value.assignedThreadId === item.assignedThreadId),
    onSave: current => act('upsert', current, projectKey, false), onError: message => { if (isCurrent()) setError(message); }
  });
  taskEditors.set(taskId, editor);
  if (project.claimThreadId || project.claimNewThread) {
    row.setAttribute('data-checklist-claim-row', '');
    const claim = make('button', '领取'); claim.type = 'button'; claim.disabled = loaded !== projectKey;
    claim.title = project.claimNewThread ? '把当前框内的内容放入新任务输入框并发送，创建新会话' : '领取当前框内的内容到会话待办，保持暂停，不自动发送';
    claim.addEventListener('pointerdown', event => event.preventDefault());
    claim.addEventListener('click', () => {
      if (project.claimNewThread) void newThreadClaim.claim(taskId, editor.read);
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
