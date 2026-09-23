export function createNativeChecklistAssignmentControl({ make, dialog, getProject, getLoaded, getRenderVersion, readChoices, view, generalItems, act, render, state }) {
  return function appendAssignmentControl(row, item, label, readTask) {
    const assign = make('button', label); assign.disabled = getLoaded() !== getProject()?.key;
    const projectKey = getProject()?.key, panelVersion = getRenderVersion();
    const current = () => {
      if (!dialog.open || getProject()?.key !== projectKey || panelVersion !== getRenderVersion() || getLoaded() !== projectKey) return null;
      return readTask ? readTask() : view(projectKey, generalItems()).find(value => value.id === item.id && value.text === item.text && value.done === item.done && value.assignedThreadId === item.assignedThreadId);
    };
    assign.addEventListener('pointerdown', event => event.preventDefault());
    assign.addEventListener('click', () => {
      if (!current()) return;
      const choices = readChoices();
      if (!choices.length) { state('暂时没有可指派的本机会话'); return; }
      const select = make('select'), confirm = make('button', '确认'), cancel = make('button', '取消');
      select.setAttribute('aria-label', '选择指派会话'); const none = make('option', '不指派'); none.value = ''; select.append(none);
      for (const choice of choices) { const option = make('option', choice.title || choice.id); option.value = choice.id; option.selected = choice.id === item.assignedThreadId; select.append(option); }
      confirm.addEventListener('pointerdown', event => event.preventDefault());
      confirm.addEventListener('click', () => { const value = current(); if (value) act('upsert', { ...value, assignedThreadId: select.value || null }, projectKey); });
      cancel.addEventListener('click', render); assign.replaceWith(select, confirm, cancel);
    }); row.append(assign);
  };
}
