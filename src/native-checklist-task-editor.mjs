export function createChecklistTaskEditor({ text, item, draft, disabled, readCurrent, onSave, onError }) {
  let baseline = draft?.baseline ?? item.text;
  text.value = draft?.value ?? item.text; text.disabled = disabled; text.rows = 1; text.maxLength = 5000;
  text.setAttribute('aria-label', '任务内容');
  text.title = '直接编辑，离开内容框时保存；操作以框内最新内容为准。Shift+Enter 换行。';
  function current() { return disabled ? null : readCurrent(baseline); }
  function read() {
    if (disabled) return null;
    const value = current();
    if (!value) { onError('任务状态已变化，未覆盖已有内容；请保留当前输入并重新打开任务清单'); return null; }
    const content = text.value.trim();
    if (!content || text.value.length > 5000) { onError(!content ? '任务内容不能为空' : '任务内容不能超过 5000 字'); return null; }
    onError(''); return { ...value, text: content };
  }
  function save() {
    const value = read(); if (!value) return;
    const changed = value.text !== baseline; baseline = value.text; text.value = value.text;
    if (changed) onSave(value);
  }
  text.addEventListener('change', save);
  text.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault(); event.stopPropagation(); save();
  });
  return {
    read, current,
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
