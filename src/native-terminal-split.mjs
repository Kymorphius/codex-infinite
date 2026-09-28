export function installNativeTerminalSplit() {
  window.__cccCreateNativeTerminalSplit = ({ record, bar, output, api }) => {
    if (record.kind !== 'claude') return null;
    const el = (tag, className = '', text = '') => {
      const node = document.createElement(tag); if (className) node.className = className;
      if (text) node.textContent = text; return node;
    };
    const key = 'terminal-review:' + record.id;
    let saved = null; try { saved = JSON.parse(sessionStorage.getItem(key) || 'null'); } catch {}
    let open = saved?.open === true, width = Number.isFinite(saved?.width) ? Math.min(720, Math.max(280, saved.width)) : null;
    let version = 0, selected = '', files = [], disposed = false, dragging = null;
    const workbench = el('div', 'workbench'), divider = el('div', 'divider'), review = el('aside', 'review');
    const toggle = el('button', 'split-toggle', '分屏'); toggle.type = 'button'; toggle.setAttribute('aria-label', '切换代码变更分屏');
    const reviewHead = el('div', 'review-head'), heading = el('strong', '', '代码变更'), refresh = el('button', 'refresh', '刷新'), close = el('button', 'close', '×');
    refresh.type = close.type = 'button'; close.setAttribute('aria-label', '关闭代码变更分屏');
    reviewHead.append(heading, refresh, close);
    const list = el('div', 'review-files'), detail = el('div', 'review-detail');
    list.setAttribute('role', 'list'); review.append(reviewHead, list, detail);
    divider.setAttribute('role', 'separator'); divider.setAttribute('aria-orientation', 'vertical'); divider.tabIndex = 0;
    workbench.append(output, divider, review); bar.append(toggle);
    if (width !== null) review.style.width = width + 'px';
    const persist = () => { try { sessionStorage.setItem(key, JSON.stringify({ open, width })); } catch {} };
    function visibility() {
      workbench.classList.toggle('is-split', open); toggle.setAttribute('aria-pressed', String(open));
      divider.hidden = review.hidden = !open; toggle.title = open ? '关闭代码变更分屏' : '打开代码变更分屏';
    }
    const message = text => { detail.replaceChildren(el('p', 'review-message', text)); };
    function renderPatch(patch, note) {
      detail.replaceChildren();
      if (note || !patch) return message(note || '这个文件没有可显示的文本差异。');
      const lines = patch.split('\n');
      for (const line of lines.slice(0, 2500)) {
        const row = el('div', line.startsWith('+') && !line.startsWith('+++') ? 'added' : line.startsWith('-') && !line.startsWith('---') ? 'removed' : line.startsWith('@@') ? 'hunk' : 'context', line || ' ');
        detail.append(row);
      }
      if (lines.length > 2500) detail.append(el('p', 'review-message', '变更较长，仅显示前 2500 行。'));
    }
    async function select(file) {
      selected = file.name;
      for (const row of list.children) row.setAttribute('aria-selected', String(row.dataset.file === selected));
      const token = ++version; message('正在读取变更…');
      try {
        const result = await api.request('changes-file', { id: record.id, file: selected });
        if (!disposed && open && token === version) renderPatch(result.patch, result.note);
      } catch (error) { if (!disposed && open && token === version) message(error.message || '无法读取变更'); }
    }
    async function load() {
      const token = ++version; list.replaceChildren(); message('正在读取项目变更…');
      try {
        const result = await api.request('changes-list', { id: record.id });
        if (disposed || !open || token !== version) return;
        files = result.files || []; heading.textContent = `代码变更 ${files.length}`;
        for (const file of files) {
          const row = el('button', 'review-file'); row.type = 'button'; row.dataset.file = file.name;
          row.textContent = file.name; row.title = file.name;
          const meta = el('span', '', file.untracked ? '未跟踪' : `+${file.added} −${file.removed}`);
          row.append(meta); row.onclick = () => void select(file); list.append(row);
        }
        if (!files.length) return message(result.unavailable || '这个项目暂无代码变更。');
        void select(files.find(file => file.name === selected) || files[0]);
      } catch (error) { if (!disposed && token === version) message(error.message || '无法读取项目变更'); }
    }
    function setOpen(value) { open = value; version++; visibility(); persist(); if (open) void load(); }
    toggle.onclick = () => setOpen(!open); close.onclick = () => setOpen(false); refresh.onclick = () => void load();
    function applyWidth(value) {
      const max = Math.max(280, Math.min(720, workbench.getBoundingClientRect().width - 340));
      width = Math.min(max, Math.max(280, value)); review.style.width = width + 'px'; persist();
    }
    divider.onpointerdown = event => {
      if (!open) return; event.preventDefault();
      dragging = { x: event.clientX, width: review.getBoundingClientRect().width };
      document.addEventListener('pointerup', finishDrag, true);
    };
    function finishDrag(event) {
      document.removeEventListener('pointerup', finishDrag, true);
      if (!dragging || disposed) return; applyWidth(dragging.width + dragging.x - event.clientX); dragging = null;
    }
    divider.onkeydown = event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault(); applyWidth(review.getBoundingClientRect().width + (event.key === 'ArrowLeft' ? 24 : -24));
    };
    visibility(); if (open) void load();
    return { element: workbench, dispose() { disposed = true; version++; document.removeEventListener('pointerup', finishDrag, true); } };
  };
}
