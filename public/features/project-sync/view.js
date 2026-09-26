import { projectKey } from './model.js';

export function createSyncView(documentRef = document) {
  const $ = selector => documentRef.querySelector(selector);
  function element(tag, className, text) {
    const node = documentRef.createElement(tag); node.className = className;
    if (text !== undefined) node.textContent = text; return node;
  }
  function text(selector, value) { const node = $(selector); if (node.textContent !== value) node.textContent = value; }
  function choices(side, state) {
    const select = $(`#${side}`), other = state[side === 'source' ? 'target' : 'source'];
    const signature = JSON.stringify([state.catalog, other?.deviceId]);
    if (select.dataset.options !== signature) {
      const first = element('option', '', side === 'source' ? '选择源项目…' : '选择目标项目…'); first.value = '';
      const groups = (state.catalog?.devices || []).map(owner => {
        const group = element('optgroup', '');
        group.label = `${owner.device.name || owner.device.id}${owner.status === 'offline' ? ' · 暂不可用' : ''}`;
        group.disabled = owner.status !== 'connected' || owner.device.id === other?.deviceId;
        for (const project of owner.projects) {
          const option = element('option', '', `${project.name} · ${project.path}`);
          option.value = projectKey({ deviceId: owner.device.id, path: project.path }); group.append(option);
        }
        return group;
      });
      select.replaceChildren(first, ...groups); select.dataset.options = signature;
    }
    select.value = state[`${side}Key`]; select.disabled = Boolean(state.busy) || !state.catalog || state.stale;
    text(`#${side}-path`, state[side]?.path || (side === 'source' ? '选择项目后显示所在目录' : '选择另一台设备上的已有项目'));
  }
  function deviceStates(state) {
    const owners = state.catalog?.devices || [], connected = owners.filter(owner => owner.status === 'connected').length;
    text('#catalog-status', state.busy === 'catalog' ? '正在读取设备项目…' : state.stale ? '设备列表待刷新' : `${connected} / ${owners.length} 台设备可用`);
    const signature = JSON.stringify(owners.map(owner => [owner.device, owner.status, owner.message, owner.projects.length]));
    if ($('#devices').dataset.status === signature) return;
    $('#devices').replaceChildren(...owners.map(owner => {
      const name = owner.device.name || owner.device.id;
      const status = owner.status === 'connected' ? `${owner.projects.length} 个项目` : `暂不可用${owner.message ? `：${owner.message}` : '，请检查连接及两端版本'}`;
      return element('span', `device-state ${owner.status}`, `${name} · ${status}`);
    }));
    $('#devices').dataset.status = signature;
  }
  function versionCard(title, snapshot) {
    const card = element('div', 'version'), list = element('dl', ''); card.append(element('h3', '', title));
    for (const [label, value] of [['分支', snapshot.branch], ['提交', snapshot.head], ['目录', '干净 · 无未提交改动']]) {
      const detail = element('dd', ''); detail.append(element(label === '提交' ? 'code' : 'span', '', value));
      list.append(element('dt', '', label), detail);
    }
    card.append(list); return card;
  }
  function render(state) {
    choices('source', state); choices('target', state); deviceStates(state);
    $('#selection').setAttribute('aria-busy', String(Boolean(state.busy)));
    $('#refresh').disabled = Boolean(state.busy);
    $('#error').hidden = !state.error; text('#error', state.error);
    $('#notice').hidden = !state.notice; text('#notice', state.notice);
    const preview = state.preflight, complete = Boolean(state.result), show = Boolean(preview) || complete;
    $('#preview').hidden = !show;
    if (show) {
      text('#preview-title', complete ? '同步已确认' : preview.unchanged ? '两端已经是同一版本' : '预检通过，可以同步');
      text('#preview-direction', `${state.source.deviceName} / ${state.source.name} → ${state.target.deviceName} / ${state.target.name}`);
      const cards = complete ? [versionCard('目标版本 · 已从设备读回', state.result.target)]
        : [versionCard('源项目 · 将同步的版本', preview.source), versionCard('目标项目 · 当前版本', preview.target)];
      $('#versions').replaceChildren(...cards);
      text('#preview-note', complete ? '目标分支、提交和干净工作目录均已核对。任务与会话仍在各自设备。' : preview.unchanged ? '无需执行同步。任务与会话仍在各自设备。'
        : `仅更新目标项目。预检有效至 ${new Date(preview.expiresAt).toLocaleTimeString('zh-CN', { hour12: false })}；执行前会再次检查两端状态。`);
    }
    for (const [selector, active, done] of [['#step-select', !show, show], ['#step-check', Boolean(preview), complete], ['#step-done', complete, false]]) {
      $(selector).classList.toggle('active', active); $(selector).classList.toggle('complete', done);
    }
    $('#preflight').disabled = !state.canPreflight;
    $('#preflight').classList.toggle('primary', !preview || preview.unchanged);
    text('#preflight', state.busy === 'preflight' ? '正在预检…' : preview ? '重新预检' : '检查同步条件');
    $('#execute').hidden = !preview || preview.unchanged; $('#execute').disabled = !state.canExecute;
    text('#execute', state.busy === 'execute' ? '正在同步并核对…' : `确认同步${state.target ? `到 ${state.target.deviceName}` : ''}`);
    text('#action-hint', state.busy === 'execute' ? '正在等待目标设备读回确认，请保持页面打开。' : state.busy === 'preflight' ? '检查分支、提交和工作目录，准备同步内容…'
      : complete ? '代码已一致；运行环境与任务接续需在目标设备确认。' : preview?.unchanged ? '代码已一致，无需同步。' : preview ? '确认方向和版本后，更新目标项目。' : state.issue || '先检查两端状态，再确认同步。');
  }
  return { render };
}
