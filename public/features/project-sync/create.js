export function mountReplicaCreate({ documentRef = document, fetchImpl = fetch } = {}) {
  const byId = name => documentRef.querySelector(`#replica-${name}`);
  let catalog, recovery = null, permit = null, busy = false, generation = 0;
  const selectedSource = () => { try { return JSON.parse(byId('source').value); } catch { return null; } };
  function invalidate() { permit = null; byId('create').hidden = true; byId('preview').hidden = true; }
  function lock(value) {
    busy = value;
    for (const name of ['source', 'device', 'parent', 'name', 'refresh', 'check', 'create', 'resume', 'recovery']) byId(name).disabled = value;
  }
  async function request(action, input) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 150000);
    try {
      const response = await fetchImpl(`/api/project-sync/${action}`, { signal: controller.signal, cache: 'no-store',
        ...(input ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) } : {}) });
      const data = await response.json();
      if (!response.ok || data.status !== 'ok') throw Error(data.message || '请求失败');
      return data;
    } catch (error) { throw Error(error.name === 'AbortError' ? '请求超时，结果未确认。请核对目标目录，不会自动重试。' : error.message); }
    finally { clearTimeout(timer); }
  }
  function option(select, value, text) {
    const item = documentRef.createElement('option'); item.value = value; item.textContent = text; select.append(item);
  }
  async function roots() {
    invalidate(); byId('parent').replaceChildren(); byId('recovery').replaceChildren(); option(byId('recovery'), '', '选择待登记副本…'); recovery = null; byId('resume').hidden = true;
    const id = byId('device').value;
    if (!id) return;
    const result = await request('create-options', { deviceId: id });
    if (!Array.isArray(result.roots)) throw Error('目标目录格式不可确认');
    for (const item of result.recoveries || []) option(byId('recovery'), JSON.stringify({ ...item, deviceId: id }), item.path);
    for (const root of result.roots) option(byId('parent'), root, root);
    if (!result.roots.length) throw Error('目标没有可用的创建目录，请检查该设备配置');
  }
  async function run(work) {
    if (busy) return; lock(true); byId('error').textContent = '';
    try { await work(); } catch (error) { invalidate(); byId('status').textContent = '本次操作未确认，请核对提示后继续。'; byId('error').textContent = error.message; }
    finally { lock(false); }
  }
  async function refresh() {
    invalidate(); recovery = null; byId('resume').hidden = true; byId('recovery').replaceChildren(); option(byId('recovery'), '', '选择目标设备后读取…'); catalog = await request('catalog');
    byId('source').replaceChildren(); byId('device').replaceChildren(); byId('parent').replaceChildren();
    option(byId('source'), '', '选择源项目…'); option(byId('device'), '', '选择目标设备…');
    if (!Array.isArray(catalog.devices)) throw Error('设备目录不可确认');
    for (const item of catalog.devices.filter(item => item.status === 'connected')) {
      option(byId('device'), item.device.id, item.device.name);
      for (const project of item.projects) option(byId('source'), JSON.stringify({ deviceId: item.device.id, path: project.path }), `${item.device.name} · ${project.name}`);
    }
    byId('status').textContent = '选择源项目、目标设备和新目录名后检查。';
  }
  for (const name of ['source', 'parent', 'name']) byId(name).addEventListener('input', () => { generation++; invalidate(); });
  byId('device').addEventListener('change', () => { generation++; void run(roots); });
  byId('refresh').addEventListener('click', () => void run(refresh));
  byId('check').addEventListener('click', () => void run(async () => {
    invalidate();
    const input = { source: selectedSource(), deviceId: byId('device').value, parent: byId('parent').value, name: byId('name').value };
    if (!input.source || !input.deviceId || !input.parent || !input.name) throw Error('请填写完整的创建选择');
    const value = await request('create-preflight', input);
    if (typeof value.token !== 'string' || !value.target?.path || !value.source?.head || !(Date.parse(value.expiresAt) > Date.now())) throw Error('创建预检未返回可确认的结果');
    permit = { ...value, generation };
    byId('preview').textContent = `源：${value.source.path}\n版本：${value.source.branch} · ${value.source.head}\n新目录：${value.target.path}`;
    byId('preview').hidden = false; byId('create').hidden = false; byId('status').textContent = '预检通过，请确认目标路径。';
  }));
  byId('create').addEventListener('click', () => void run(async () => {
    const current = permit; invalidate();
    if (!current || current.generation !== generation || Date.parse(current.expiresAt) <= Date.now()) throw Error('预检已变化或过期，请重新检查');
    byId('status').textContent = '正在创建并登记，请留意目标桌面的目录确认…';
    const result = await request('create-execute', { token: current.token });
    if (result.verified === false && result.operationId && result.target?.path === current.target.path) {
      recovery = { deviceId: current.target.deviceId, operationId: result.operationId, path: current.target.path, head: current.source.head };
      byId('resume').hidden = false; throw Error(result.message || '副本已保留，请确认后继续登记');
    }
    if (result.verified !== true || result.target?.path !== current.target.path || result.target?.head !== current.source.head || result.target?.branch !== current.source.branch || result.target?.clean !== true) throw Error('创建结果未确认，请核对目标目录，勿重复创建');
    byId('status').textContent = `副本创建并登记成功：${result.target.path}。返回同步页刷新即可选择。`;
  }));
  byId('recovery').addEventListener('change', () => { recovery = byId('recovery').value ? JSON.parse(byId('recovery').value) : null; byId('resume').hidden = !recovery; });
  byId('resume').addEventListener('click', () => void run(async () => {
    if (!recovery) throw Error('没有待登记的副本记录');
    const result = await request('create-resume', { deviceId: recovery.deviceId, operationId: recovery.operationId });
    if (result.verified !== true || result.target?.path !== recovery.path || result.target?.head !== recovery.head) throw Error('恢复登记结果未确认，请核对目标设备');
    byId('status').textContent = `副本已登记并读回确认：${result.target.path}。返回同步页刷新即可选择。`;
    recovery = null; byId('resume').hidden = true; byId('recovery').replaceChildren(); option(byId('recovery'), '', '此副本登记已完成');
  }));
  void run(refresh);
}
if (typeof document !== 'undefined') mountReplicaCreate();
