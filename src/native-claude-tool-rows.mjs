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
  const rootSelector = '[data-thread-user-message-navigation-content],[data-app-action-timeline-scroll]';
  const rowAttribute = 'data-ccc-claude-tool-row';
  const inlineSelector = 'em,strong,b,i,code,span,a,del,s,br';
  const style = document.querySelector('style[data-ccc-claude-tool-style]') || document.createElement('style');
  style.setAttribute('data-ccc-claude-tool-style', '');
  style.textContent = `
    [${rowAttribute}] { margin:2px 0!important;color:#a6a6aa;font:500 14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    [data-ccc-claude-tool-container] { margin-block:0!important;padding-block:0!important;row-gap:0!important;min-height:0!important; }
    [data-ccc-claude-tool-adjacent] { margin-block-start:calc(4px - var(--ccc-claude-tool-parent-gap, 0px))!important; }
    [data-ccc-claude-tool-container="empty"] { display:none!important; }
    [${rowAttribute}] summary { display:flex;align-items:center;gap:10px;max-width:100%;cursor:pointer;list-style:none; }
    [${rowAttribute}] summary::-webkit-details-marker { display:none; }
    [${rowAttribute}] summary:hover { color:#ddd; }
    [${rowAttribute}] [data-ccc-claude-tool-icon] { display:inline-flex;align-items:center;justify-content:center;flex:none;width:17px;height:17px;border:1.5px solid currentColor;border-radius:4px;font:700 10px/1 monospace;opacity:.88; }
    [${rowAttribute}] [data-ccc-claude-tool-label] { overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
    [${rowAttribute}] pre { margin:7px 0 10px 27px;padding:8px 10px;border-radius:7px;background:#ffffff0b;color:#bbb;white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace; }
  `;
  document.head.append(style);
  if (window.__cccClaudeToolRows) {
    window.__cccClaudeToolRows.render();
    compact(document.querySelector(rootSelector));
    window.__codexControlConsoleMutationSubscribers?.delete(window.__cccClaudeToolRows.compact);
    window.__cccClaudeToolRows.compact = () => compact(document.querySelector(rootSelector));
    (window.__codexControlConsoleMutationSubscribers ||= new Set()).add(window.__cccClaudeToolRows.compact);
    return;
  }
  // Only collapse wrappers containing tool notices exclusively, never prose or turns.
  function compact(node) {
    if (!node) return false;
    if (node.hasAttribute?.(rowAttribute)) return true;
    if (node.hasAttribute?.('data-ccc-claude-tool-source')) return true;
    if (!node.children?.length && node.style?.display === 'none' && parseNotice(node.textContent)) return true;
    if (node.matches?.('.sr-only,[hidden]')) return null;
    const children = [...(node.children || [])];
    if (!children.length && !node.textContent?.trim() && !node.matches?.('button,input,textarea,select,img,svg,canvas,video,iframe,[role]')) return null;
    const kinds = children.map(compact);
    const directText = [...(node.childNodes || [])].some(child => child.nodeType === 3 && child.textContent.trim());
    const pure = !directText && kinds.includes(true) && kinds.every(kind => kind !== false);
    const boundary = node.matches?.(rootSelector) || node.matches?.('[data-turn-key]');
    const value = node.querySelector?.(`[${rowAttribute}]`) ? 'rows' : 'empty';
    if (pure && !boundary) {
      if (node.getAttribute('data-ccc-claude-tool-container') !== value) node.setAttribute('data-ccc-claude-tool-container', value);
    } else if (node.hasAttribute?.('data-ccc-claude-tool-container')) node.removeAttribute('data-ccc-claude-tool-container');
    // Native search keys also wrap individual assistant messages. Their parent
    // retains a large flex gap even when its tool-only children have no margins.
    let previousTool = false;
    for (const child of children) {
      if (child.getAttribute?.('data-ccc-claude-tool-container') === 'empty') continue;
      const tool = child.hasAttribute?.(rowAttribute) || child.getAttribute?.('data-ccc-claude-tool-container') === 'rows';
      const gap = !pure && !boundary && previousTool && tool && typeof getComputedStyle === 'function'
        ? parseFloat(getComputedStyle(node).rowGap) : 0;
      if (gap > 4) {
        const value = `${gap}px`;
        if (child.style.getPropertyValue('--ccc-claude-tool-parent-gap') !== value) child.style.setProperty('--ccc-claude-tool-parent-gap', value);
        if (!child.hasAttribute('data-ccc-claude-tool-adjacent')) child.setAttribute('data-ccc-claude-tool-adjacent', '');
      } else if (child.hasAttribute?.('data-ccc-claude-tool-adjacent')) {
        child.removeAttribute('data-ccc-claude-tool-adjacent');
        child.style.removeProperty('--ccc-claude-tool-parent-gap');
      }
      previousTool = Boolean(tool);
    }
    if (!boundary && !directText && kinds.length && kinds.every(kind => kind === null)) return null;
    return pure && !boundary;
  }

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
      // Markdown may render command globs as <em>/<code>; accept inline-only
      // children but never an element that already wraps a converted notice.
      if (source.closest?.(`[${rowAttribute}]`) || [...source.children].some(child => !child.matches?.(inlineSelector))) continue;
      if (source.parentElement?.closest?.('[data-ccc-claude-tool-source]')) continue;
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
      source.setAttribute('data-ccc-claude-tool-source', '');
      processed.set(source, original);
    }
    compact(root);
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
