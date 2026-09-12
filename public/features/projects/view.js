import { actionReason, moveTargets, pinTarget, sourceLabel } from './model.js';

export function createProjectView(documentRef = document) {
  const $ = selector => documentRef.querySelector(selector);
  const grid = $('#project-grid'), cards = new Map();
  function options(select, entries, first) {
    const signature = JSON.stringify(entries);
    if (select.dataset.options === signature) return;
    const previous = select.value;
    const children = [{ value: '', label: first }, ...entries].map(entry => {
      const option = documentRef.createElement('option'); option.value = entry.value; option.textContent = entry.label; return option;
    });
    select.replaceChildren(...children); select.dataset.options = signature;
    select.value = entries.some(entry => entry.value === previous) ? previous : '';
  }
  function text(node, value) { if (node.textContent !== value) node.textContent = value; }
  function updateCard(card, project, busy) {
    const find = selector => card.querySelector(selector);
    card.dataset.projectId = project.identity;
    text(find('.project-name'), project.name);
    find('.project-name').title = project.name;
    text(find('.source-badge'), sourceLabel(project.source));
    text(find('.device-name'), `${project.deviceName}${project.deviceKind === 'local-codex' ? ' · 本机' : ''}`);
    find('.device-name').title = project.deviceName;
    find('.pin-badge').hidden = !project.pinned;
    find('.cache-badge').hidden = !project.stale;
    text(find('.section-name'), project.section?.name || '未映射分区');
    find('.section-name').title = project.memberships.map(section => section.name).join(' / ');
    text(find('.conversation-count'), project.conversationCount === null ? '会话数未知' : `${project.conversationCount} 个已载入会话`);
    const paths = find('.project-paths'), pathKey = JSON.stringify(project.sourceDirectories);
    if (paths.dataset.paths !== pathKey) {
      const labels = project.sourceDirectories.length ? project.sourceDirectories : [project.source === 'chatgpt' ? '云端项目 · 无本地路径' : '未提供项目路径'];
      paths.replaceChildren(...labels.map(path => { const row = documentRef.createElement('p'); row.textContent = path; return row; }));
      paths.dataset.paths = pathKey;
    }
    const open = find('.open-project'), copy = find('.copy-path'), pin = find('.pin-project'), move = find('.move-project');
    const openReason = actionReason(project, 'open'), moveReason = actionReason(project, 'item-move'), target = pinTarget(project);
    open.disabled = busy || Boolean(openReason); open.title = openReason || (project.deviceKind === 'remote-codex' ? `在 ${project.deviceName} 打开` : '在 Codex 打开项目');
    open.setAttribute('aria-label', `打开 ${project.name}`);
    copy.disabled = !project.sourceDirectories.length;
    copy.title = copy.disabled ? '该项目没有可复制的本地路径' : '复制项目的所有路径';
    text(pin, project.pinned ? '取消置顶' : '置顶');
    pin.disabled = busy || Boolean(moveReason) || !target;
    pin.title = moveReason || (!target ? '所属设备未提供目标分区' : `${project.pinned ? '移回' : '移到'}「${target.name}」`);
    options(move, moveTargets(project).map(section => ({ value: section.id, label: section.name })), '移动到分区…');
    move.disabled = busy || Boolean(moveReason) || !moveTargets(project).length;
    move.title = moveReason || '移动到所属设备的现有分区';
    text(find('.capability-note'), moveReason || openReason || '');
    card.setAttribute('aria-busy', String(busy));
  }
  function render(state) {
    const { catalog, visible } = state;
    text($('#catalog-count'), state.payload ? String(catalog.projects.length) : '—');
    options($('#device'), catalog.devices.map(owner => ({ value: owner.device.id, label: owner.device.name || owner.device.id })), '全部设备');
    options($('#section'), catalog.sections.map(section => ({ value: section.filterId, label: `${section.name} · ${section.deviceName}` })), '全部分区');
    for (const key of ['device', 'source', 'section', 'sort']) $(`#${key}`).value = state.filters[key];
    if ($('#search').value !== state.filters.query) $('#search').value = state.filters.query;
    $('#clear').disabled = !['query', 'device', 'source', 'section'].some(key => state.filters[key]);
    $('#refresh').disabled = state.loading || Boolean(state.busy);
    const connected = catalog.devices.filter(owner => owner.status === 'connected').length;
    text($('#result-count'), state.payload ? `显示 ${visible.length} / ${catalog.projects.length} 个项目` : state.loading ? '正在读取项目…' : '项目列表暂不可用');
    text($('#sync-status'), state.loading ? '正在刷新…' : state.stale ? '列表待刷新' : `${connected} / ${catalog.devices.length} 台设备在线`);
    $('#read-error').hidden = !state.readError;
    text($('#read-error'), state.readError ? `${state.readError}${state.payload ? '。已保留上次列表，原生操作暂不可用。' : '。请稍后刷新重试。'}` : '');
    const deviceStatus = $('#device-status');
    const deviceMessages = catalog.devices.filter(owner => owner.status !== 'connected').map(owner => ({ status: owner.status,
      message: `${owner.device.name || owner.device.id} · ${owner.status === 'loading' ? '正在加载项目' : owner.snapshot ? '离线，显示缓存' : '暂不可用'}${owner.message ? `：${owner.message}` : ''}` }));
    const deviceKey = JSON.stringify(deviceMessages);
    if (deviceStatus.dataset.status !== deviceKey) {
      deviceStatus.replaceChildren(...deviceMessages.map(value => { const node = documentRef.createElement('span'); node.className = `device-state ${value.status}`; node.textContent = value.message; return node; }));
      deviceStatus.dataset.status = deviceKey;
    }
    const wanted = new Set(visible.map(project => project.identity));
    for (const [id, card] of cards) if (!wanted.has(id)) { card.remove(); cards.delete(id); }
    visible.forEach((project, index) => {
      let card = cards.get(project.identity);
      if (!card) { card = $('#project-card-template').content.firstElementChild.cloneNode(true); cards.set(project.identity, card); }
      updateCard(card, project, Boolean(state.busy));
      if (grid.children[index] !== card) grid.insertBefore(card, grid.children[index] || null);
    });
    grid.setAttribute('aria-busy', String(state.loading));
    $('#empty-state').hidden = visible.length > 0;
    text($('#empty-title'), state.loading && !state.payload ? '正在连接你的项目' : !state.payload ? '暂时无法读取项目' : catalog.projects.length ? '没有匹配的项目' : '暂无可显示的项目');
    text($('#empty-description'), state.loading && !state.payload ? '正在读取各设备的原生项目列表…' : !state.payload ? '请检查设备连接，然后点击刷新。' : catalog.projects.length ? '试试其他关键词，或清除筛选。' : connected < catalog.devices.length ? '部分设备仍未就绪，连接后会自动更新。' : '这里会显示各设备原生侧边栏中的项目。');
  }
  function notice(message, error = false) {
    const node = $('#action-notice'); node.hidden = !message; node.classList.toggle('error', error); text(node, message);
  }
  return { render, notice };
}
