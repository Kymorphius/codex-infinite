export function createExperimentsFeature({ $, documentRef = document, fetchImpl = fetch }) {
  let payload = null, pending = null;
  const list = $('[data-testid="experiments-devices"]');
  const status = $('[data-testid="experiments-status"]');
  const filter = $('[data-testid="experiments-all"]');
  function element(tag, text, className) {
    const node = documentRef.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function render(value = payload) {
    payload = value;
    list.replaceChildren();
    for (const { device, snapshot } of value?.devices || []) {
      const card = element('section', '', 'experiment-device');
      card.append(element('h3', device.name || device.id));
      card.append(element('p', snapshot.observedAt ? `读取时间：${new Date(snapshot.observedAt).toLocaleString()}` : '尚未取得设备状态', 'experiment-meta'));
      for (const [key, title] of [['native', 'Codex 原生实验'], ['console', '控制台扩展']]) {
        const group = snapshot[key];
        const section = element('section', '', 'experiment-group');
        section.append(element('h4', title));
        if (group?.status !== 'connected') {
          section.append(element('p', '暂时无法读取；设备可能离线或尚未支持此页面。', 'experiment-unavailable'));
        } else {
          const items = group.items || [];
          section.append(element('p', `${items.filter(item => item.enabled).length} 项已启用 · 共 ${items.length} 项`, 'experiment-meta'));
          const visible = items.filter(item => filter.checked || item.enabled);
          if (!visible.length) section.append(element('p', filter.checked ? '设备未返回此类功能。' : '此类功能没有已启用项。'));
          for (const item of visible) {
            const row = element('article', '', 'experiment-item');
            const heading = element('div', '', 'experiment-heading');
            heading.append(element('strong', item.title || item.name), element('span', item.enabled ? '已启用' : '未启用', item.enabled ? 'experiment-on' : 'experiment-meta'));
            row.append(heading, element('code', item.name));
            if (item.description) row.append(element('p', item.description));
            if (item.stage) row.append(element('small', `阶段：${({ underDevelopment: "开发中", beta: "测试中" })[item.stage] || item.stage}`, 'experiment-meta'));
            section.append(row);
          }
        }
        card.append(section);
      }
      list.append(card);
    }
  }
  function load() {
    if (pending) return pending;
    status.textContent = payload ? '正在刷新；下方保留上次读取结果…' : '正在读取各设备的实验功能…';
    pending = (async () => {
      try {
        const response = await fetchImpl('/api/experiments');
        if (!response.ok) throw new Error('Unavailable');
        const value = await response.json();
        if (!Array.isArray(value.devices)) throw new Error('Invalid inventory');
        render(value);
        status.textContent = value.devices.length ? '状态来自各设备控制台连接的原生窗口；控制台扩展的“已启用”表示能力已加载，具体会话策略以会话设置为准。' : '尚未发现设备。';
      } catch {
        status.textContent = payload ? '刷新失败，下方仍是上次读取结果，请稍后重试。' : '实验功能暂时无法读取，请稍后重试。';
      } finally { pending = null; }
    })();
    return pending;
  }
  function bind() {
    filter.addEventListener('change', () => render());
    $('[data-action="experiments-refresh"]').addEventListener('click', () => void load());
  }
  return { bind, load, render };
}
