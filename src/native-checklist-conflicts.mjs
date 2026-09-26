export function createChecklistConflictView({ make, readPending, dismiss }) {
  const root = make('details'), summary = make('summary'), body = make('div');
  root.append(summary, body); root.hidden = true;
  let signature = '';
  return { root, render() {
    const drafts = readPending().filter(action => action.conflict), next = JSON.stringify(drafts);
    if (next === signature) return;
    signature = next; root.hidden = !drafts.length; summary.textContent = `${drafts.length} 项更改未保存，查看保留的草稿`;
    body.replaceChildren();
    for (const draft of drafts) {
      const row = make('div'), reason = make('small', draft.conflict), text = make('textarea'), remove = make('button', '丢弃草稿');
      text.value = draft.text || ''; text.readOnly = true; text.setAttribute('aria-label', '未保存的任务草稿');
      remove.addEventListener('click', () => dismiss(draft.requestId));
      row.append(reason, text, remove); body.append(row);
    }
  } };
}
