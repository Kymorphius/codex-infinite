export function createChecklistSearch(make) {
  const root = make('div'); root.dataset.checklistSearch = '';
  const input = make('input'); input.type = 'search'; input.placeholder = '搜索任务内容…'; input.setAttribute('aria-label', '搜索任务');
  const clear = make('button', '清空'); clear.type = 'button'; clear.hidden = true;
  const result = make('small'); result.textContent = ''; result.setAttribute('aria-live', 'polite');
  root.append(input, clear, result);
  let rows = [];
  function apply() {
    const query = input.value.trim().toLowerCase();
    let matches = 0;
    for (const { row, readText } of rows) {
      const visible = !query || String(readText() ?? '').toLowerCase().includes(query);
      if (visible) matches++;
      if (row.hidden !== !visible) row.hidden = !visible;
    }
    const label = !query ? '' : matches ? '匹配 ' + matches + ' 项' : '没有匹配的任务';
    if (result.textContent !== label) result.textContent = label;
    if (clear.hidden !== !query) clear.hidden = !query;
  }
  function reset() { if (input.value !== '') input.value = ''; apply(); }
  input.addEventListener('input', apply);
  input.addEventListener('keydown', event => { if (event.key === 'Enter') event.preventDefault(); });
  clear.addEventListener('click', () => { reset(); input.focus(); });
  return {
    root, register(row, readText) { rows.push({ row, readText }); },
    resetRows() { rows = []; }, apply, reset
  };
}
