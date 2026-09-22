export function appendClaimableTaskControls({ row, text, make, item, draft, disabled, readCurrent, onSave, onClaim, onError }) {
  const claim = make('button', '领取'); claim.type = 'button'; claim.disabled = disabled;
  claim.title = '领取当前框内的内容到会话待办，保持暂停，不自动发送';
  let baseline = draft?.baseline ?? item.text;
  text.value = draft?.value ?? item.text; text.disabled = disabled; text.rows = 2;
  text.title = '直接编辑，离开内容框时保存；领取以框内最新内容为准。Shift+Enter 换行。';
  function commit(claiming) {
    if (disabled) return;
    const current = readCurrent(baseline);
    if (!current) { onError('任务状态已变化，未覆盖已有内容；请保留当前输入并重新打开领取列表'); return; }
    const value = text.value.trim();
    if (!value || text.value.length > 5000) { onError(!value ? '任务内容不能为空' : '任务内容不能超过 5000 字'); return; }
    baseline = value; text.value = value; onError('');
    if (claiming) onClaim({ ...current, text: value });
    else if (value !== current.text) onSave({ ...current, text: value });
  }
  text.addEventListener('change', () => commit(false));
  text.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault(); event.stopPropagation(); commit(false);
  });
  claim.addEventListener('pointerdown', event => event.preventDefault());
  claim.addEventListener('click', () => commit(true));
  row.append(text, claim);
  return {
    snapshot() {
      const focused = text.ownerDocument?.activeElement === text;
      return text.value !== baseline || focused ? { value: text.value, baseline, focused, start: text.selectionStart, end: text.selectionEnd } : null;
    },
    restoreFocus() {
      if (!draft?.focused) return;
      text.focus(); if (typeof text.setSelectionRange === 'function') text.setSelectionRange(draft.start, draft.end);
    }
  };
}
