// Presentation only: Claude CLI tools have already executed inside the Router.
// These rows never create a Codex tool call or send tool output back to Claude.
export function parseClaudeNativeToolNotice(value) {
  if (typeof value !== 'string' || value.length > 850) return null;
  const match = /^Claude 原生工具：([A-Za-z][A-Za-z0-9_]{0,79})(?: · (.{1,700}))?（(执行中|已完成|未成功)(?: · 退出码 (-?\d{1,5}))?）$/u.exec(value.trim());
  if (!match) return null;
  const [, name, detail = '', status, exitCode] = match;
  const action = name === 'Bash' ? '运行命令'
    : name === 'Read' ? '读取文件'
    : ['Edit', 'Write', 'NotebookEdit'].includes(name) ? '修改文件'
    : ['Grep', 'Glob'].includes(name) ? '搜索文件'
    : `使用 ${name}`;
  const verb = status === '执行中' ? '正在' : status === '未成功' ? '未能' : '已';
  const short = ['Read', 'Edit', 'Write', 'NotebookEdit'].includes(name) && detail
    ? detail.split(/[\\/]/u).at(-1) : '';
  return { name, detail, status, label: `${verb}${action}${short ? ` ${short}` : ''}`,
    icon: name === 'Bash' ? 'terminal' : ['Read', 'Edit', 'Write', 'NotebookEdit'].includes(name) ? 'file' : 'tool',
    exitCode: exitCode === undefined ? null : Number(exitCode) };
}

export function installNativeClaudeToolRows(parseNotice) {
  if (window.__cccClaudeToolRows) { window.__cccClaudeToolRows.render(); return; }
  const rootSelector = '[data-thread-user-message-navigation-content],[data-app-action-timeline-scroll]';
  const rowAttribute = 'data-ccc-claude-tool-row';
  const style = document.createElement('style');
  style.textContent = `
    [${rowAttribute}] { margin:5px 0;color:#a6a6aa;font:500 14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    [${rowAttribute}] summary { display:flex;align-items:center;gap:10px;max-width:100%;cursor:pointer;list-style:none; }
    [${rowAttribute}] summary::-webkit-details-marker { display:none; }
    [${rowAttribute}] summary:hover { color:#ddd; }
    [${rowAttribute}] [data-ccc-claude-tool-icon] { display:inline-flex;align-items:center;justify-content:center;flex:none;width:17px;height:17px;border:1.5px solid currentColor;border-radius:4px;font:700 10px/1 monospace;opacity:.88; }
    [${rowAttribute}] [data-ccc-claude-tool-label] { overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
    [${rowAttribute}] pre { margin:7px 0 10px 27px;padding:8px 10px;border-radius:7px;background:#ffffff0b;color:#bbb;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace; }
  `;
  document.head.append(style);
  const processed = new WeakMap(), pending = new Map();
  let queued = false;
  function key(source, notice) {
    const turn = source.closest?.('[data-turn-key],[data-content-search-turn-key]');
    return `${turn?.getAttribute('data-turn-key') || turn?.getAttribute('data-content-search-turn-key') || ''}\u0000${notice.name}\u0000${notice.detail}`;
  }
  function update(row, notice) {
    row.querySelector('[data-ccc-claude-tool-label]').textContent = notice.label;
    row.querySelector('pre').textContent = (notice.detail || notice.name)
      + (notice.exitCode === null ? '' : `\n退出码：${notice.exitCode}`);
    row.dataset.cccClaudeToolStatus = notice.status;
    row.setAttribute('aria-label', notice.label);
  }
  function makeRow(notice) {
    const row = document.createElement('details'); row.setAttribute(rowAttribute, '');
    const summary = document.createElement('summary');
    const icon = document.createElement('span'); icon.dataset.cccClaudeToolIcon = notice.icon;
    icon.setAttribute('aria-hidden', 'true'); icon.textContent = notice.icon === 'terminal' ? '>_' : notice.icon === 'file' ? '▤' : '✦';
    const label = document.createElement('span'); label.dataset.cccClaudeToolLabel = '';
    const detail = document.createElement('pre');
    summary.append(icon, label); row.append(summary, detail); update(row, notice);
    return row;
  }
  function render() {
    const root = document.querySelector(rootSelector);
    if (!root) return;
    for (const source of root.querySelectorAll('p,div,span')) {
      if (source.closest?.(`[${rowAttribute}]`) || source.children.length) continue;
      const original = source.textContent || '';
      if (processed.get(source) === original) continue;
      const notice = parseNotice(original);
      if (!notice) continue;
      const identity = key(source, notice);
      if (notice.status !== '执行中') {
        const queue = pending.get(identity);
        const earlier = queue?.find(item => item.isConnected);
        if (earlier) { update(earlier, notice); queue.splice(queue.indexOf(earlier), 1); }
        else { const row = makeRow(notice); source.before(row); }
      } else {
        const row = makeRow(notice); source.before(row);
        const queue = pending.get(identity) || []; queue.push(row); pending.set(identity, queue);
      }
      source.style.display = 'none';
      processed.set(source, original);
    }
  }
  function schedule() {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; render(); });
  }
  (window.__codexControlConsoleMutationSubscribers ||= new Set()).add(schedule);
  const observer = !window.__codexControlConsoleObserver && typeof MutationObserver === 'function'
    ? new MutationObserver(schedule) : null;
  observer?.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  window.__cccClaudeToolRows = { render };
  render();
}

export function buildNativeClaudeToolRowsInjectionScript() {
  return `;(${installNativeClaudeToolRows.toString()})(${parseClaudeNativeToolNotice.toString()})`;
}
