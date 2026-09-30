const endedStatuses = new Set(['completed', 'idle', 'interrupted', 'error', 'failed', 'cancelled', 'canceled', 'archived']);
const uuid = value => typeof value === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(value);
const sameProject = (left, right) => left?.deviceId === right?.deviceId && left?.path === right?.path;

export function mountConversationCopy({ documentRef = document, fetchImpl = fetch, now = Date.now, requestTimeoutMs = 150000 } = {}) {
  const byId = name => documentRef.querySelector(`#conversation-${name}`), controllers = new Set();
  let projects = [], conversations = [], operations = [], permit = null, recovery = null, result = null, busy = false, revision = 0, disposed = false;
  const selection = name => { try { return JSON.parse(byId(name).value); } catch { return null; } };
  const selectedProject = name => projects.find(project => sameProject(project, selection(name)));
  const selectedThread = () => conversations.find(thread => thread.threadId === byId('thread').value);
  const blockedReason = thread => thread.reason || thread.blockedReason || (thread.isSubagent ? '子任务会话暂不能独立复制' :
    !endedStatuses.has(thread.status) ? '会话状态尚未确认结束' : thread.eligible === false ? '会话暂不能独立复制' : '');
  function option(select, value, label, disabled = false) {
    const node = documentRef.createElement('option'); node.value = value; node.textContent = label; node.disabled = disabled; select.append(node);
  }
  function invalidate() { permit = null; byId('copy').hidden = true; byId('preview').hidden = true; }
  function recoveryView() {
    byId('resume').hidden = !recovery; byId('recovery').hidden = !recovery;
    byId('recovery').textContent = recovery ? `待核对设备：${recovery.target.deviceId} · ${recovery.target.path}\n操作记录：${recovery.operationId}。只继续同一操作，不会重新发起复制。` : '';
  }
  function lock(value) {
    busy = value;
    for (const name of ['source', 'thread', 'target', 'note', 'operations', 'refresh', 'check', 'copy', 'resume']) byId(name).disabled = value;
  }
  async function request(action, input) {
    const controller = new AbortController(); controllers.add(controller); let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Error('请求超时，结果未确认。不会自动重试。')); }, requestTimeoutMs); });
    try {
      const response = await Promise.race([fetchImpl(`/api/project-sync/${action}`, { signal: controller.signal, cache: 'no-store',
        ...(input ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) } : {}) }), timeout]);
      const data = await Promise.race([response.json(), timeout]);
      if (!response.ok || data.status !== 'ok') {
        const error = Error(data.message || '请求失败');
        if (typeof data.details?.applyStarted === 'boolean') error.details = { applyStarted: data.details.applyStarted };
        throw error;
      }
      return data;
    } finally { clearTimeout(timer); controllers.delete(controller); }
  }
  async function run(work) {
    if (busy || disposed) return false; lock(true); byId('error').textContent = '';
    try { await work(); return true; }
    catch (error) { invalidate(); byId('status').textContent = '本次操作未确认，请核对提示后继续。'; byId('error').textContent = error.message; return false; }
    finally { lock(false); recoveryView(); }
  }
  function clearThreads() {
    conversations = []; byId('thread').replaceChildren(); option(byId('thread'), '', '先选择源项目…'); byId('list-note').textContent = '';
  }
  function clearOperations(label = '选择目标项目后读取…') {
    operations = []; byId('operations').replaceChildren(); option(byId('operations'), '', label);
  }
  function operationOptions() {
    const target = selectedProject('target'); byId('operations').replaceChildren();
    option(byId('operations'), '', operations.length ? '选择待核对的副本…' : '此目标没有待核对副本');
    for (const operation of operations) option(byId('operations'), operation.operationId, `${operation.title} · ${operation.operationId}`);
    if (recovery && sameProject(recovery.target, target)) {
      if (!operations.some(operation => operation.operationId === recovery.operationId)) option(byId('operations'), recovery.operationId, `本次待核对副本 · ${recovery.operationId}`);
      byId('operations').value = recovery.operationId;
    }
  }
  async function listOperations() {
    return run(async () => {
      clearOperations(); const target = selectedProject('target'), current = revision;
      if (!target) return;
      const data = await request('conversation-operations', { deviceId: target.deviceId });
      if (current !== revision || !sameProject(target, selectedProject('target'))) return;
      if (!Array.isArray(data.operations) || data.operations.some(operation => !uuid(operation.operationId) || typeof operation.path !== 'string' ||
        !uuid(operation.sourceThreadId) || typeof operation.title !== 'string' || !['prepared', 'needs-review', 'completed'].includes(operation.status)))
        throw Error('保留的副本记录格式不可确认');
      operations = data.operations.filter(operation => operation.path === target.path && (operation.status === 'needs-review' ||
        operation.status === 'prepared' && operation.resumeEligible === true)); operationOptions();
    });
  }
  function targets() {
    clearOperations(); byId('target').replaceChildren(); option(byId('target'), '', '选择目标项目…'); const source = selectedProject('source');
    for (const project of projects.filter(project => source?.sharedProjectId && source.sharedProjectId === project.sharedProjectId && source.deviceId !== project.deviceId))
      option(byId('target'), JSON.stringify({ deviceId: project.deviceId, path: project.path }), `${project.deviceName} · ${project.name}`);
    if (source && !source.sharedProjectId) byId('list-note').textContent = '请先返回项目同步，为源项目和目标副本关联同一项目身份。';
  }
  async function refresh() {
    return run(async () => {
      revision++; invalidate(); clearThreads(); projects = []; targets(); byId('source').replaceChildren(); option(byId('source'), '', '选择源项目…');
      const data = await request('catalog');
      if (!Array.isArray(data.devices)) throw Error('设备目录格式不可确认');
      for (const item of data.devices) {
        if (item.status !== 'connected') continue;
        if (typeof item.device?.id !== 'string' || !Array.isArray(item.projects)) throw Error('设备目录格式不可确认');
        for (const project of item.projects) {
          if (typeof project.path !== 'string' || typeof project.name !== 'string') throw Error('项目目录格式不可确认');
          projects.push({ ...project, deviceId: item.device.id, deviceName: item.device.name || item.device.id });
        }
      }
      for (const project of projects) option(byId('source'), JSON.stringify({ deviceId: project.deviceId, path: project.path }), `${project.deviceName} · ${project.name}`);
      byId('status').textContent = '选择源项目、已结束会话和目标项目后检查。';
    });
  }
  async function listConversations() {
    return run(async () => {
      const source = selectedProject('source'), current = revision; clearThreads(); targets();
      if (!source) return;
      const data = await request('conversation-list', { source: { deviceId: source.deviceId, path: source.path } });
      if (current !== revision || !sameProject(source, selectedProject('source'))) return;
      if (!Array.isArray(data.conversations)) throw Error('会话列表格式不可确认');
      conversations = data.conversations; byId('thread').replaceChildren(); option(byId('thread'), '', '选择已结束会话…');
      for (const thread of conversations) {
        if (!uuid(thread.threadId) || typeof thread.title !== 'string') throw Error('会话列表格式不可确认');
        const reason = blockedReason(thread); option(byId('thread'), thread.threadId, `${thread.title}${reason ? ` · ${reason}` : ''}`, Boolean(reason));
      }
      if (!conversations.length) byId('list-note').textContent = '此项目暂无可复制的已结束主会话。';
      byId('status').textContent = '请选择会话与已关联的目标项目。';
    });
  }
  async function preflight() {
    return run(async () => {
      invalidate(); result = null;
      if (recovery) throw Error('上次复制结果待核对，请先核对已有副本。');
      const source = selectedProject('source'), target = selectedProject('target'), thread = selectedThread(), note = byId('note').value.trim(), current = revision;
      if (!source || !target || !thread) throw Error('请选择源项目、已结束会话和目标项目。');
      if (blockedReason(thread)) throw Error(blockedReason(thread));
      if (source.deviceId === target.deviceId) throw Error('请选择另一台设备的项目副本。');
      if (!source.sharedProjectId || source.sharedProjectId !== target.sharedProjectId) throw Error('两个项目尚未关联同一项目身份。');
      if (note.length > 2000) throw Error('交接说明最多 2000 字。');
      const input = { source: { deviceId: source.deviceId, path: source.path }, threadId: thread.threadId, target: { deviceId: target.deviceId, path: target.path }, note };
      const data = await request('conversation-preflight', input);
      if (current !== revision) return;
      if (typeof data.token !== 'string' || !data.token || !(Date.parse(data.expiresAt) > now()) || !uuid(data.operationId) ||
        !sameProject(data.source, input.source) || !sameProject(data.target, input.target) || data.thread?.threadId !== input.threadId ||
        typeof data.thread.title !== 'string' || !/^[a-f\d]{64}$/i.test(data.thread.sha256 || '') || !Number.isSafeInteger(data.thread.bytes) || data.thread.bytes < 1 || data.thread.bytes > 8 * 1024 * 1024)
        throw Error('预检未返回可确认的会话与目标，请重新检查。');
      permit = { ...data, note, revision: current };
      byId('preview').textContent = `源会话：${data.thread.title}\n源项目：${data.source.path}\n目标设备：${target.deviceName}\n目标项目：${data.target.path}\n历史大小：${data.thread.bytes} 字节\n${note ? `交接说明：${note}\n` : ''}确认后生成独立会话 ID；不自动启动任务。`;
      byId('preview').hidden = false; byId('copy').hidden = false; byId('status').textContent = '预检通过。请确认复制会话历史的目标。';
    });
  }
  function acceptResult(data, expected) {
    if (data.verified !== true || data.operationId !== expected.operationId || !uuid(data.targetThreadId) || data.targetThreadId === expected.threadId ||
      (data.sourceThreadId && data.sourceThreadId !== expected.threadId) ||
      data.path !== expected.target.path || (data.target && !sameProject(data.target, expected.target)) || typeof data.title !== 'string')
      throw Error(data.message || '副本结果尚未确认，请核对已有副本。不会重新复制。');
    result = data; recovery = null; operations = operations.filter(operation => operation.operationId !== expected.operationId); operationOptions();
    byId('status').textContent = `会话副本已读回确认：${data.title}\n目标设备：${expected.target.deviceId}\n目标项目：${data.path}\n独立会话 ID：${data.targetThreadId}\n可在目标设备打开并继续工作；尚未自动启动任务。`;
  }
  async function execute() {
    return run(async () => {
      const current = permit; invalidate();
      if (!current || current.revision !== revision || Date.parse(current.expiresAt) <= now()) throw Error('预检已变化或过期，请重新检查。');
      const expected = { operationId: current.operationId, target: current.target, threadId: current.thread.threadId }; recovery = expected;
      byId('status').textContent = '正在复制历史并核对目标会话…';
      try { const data = await request('conversation-execute', { token: current.token }); acceptResult(data, expected); }
      catch (error) {
        if (error.details?.applyStarted === false) {
          recovery = null; operations = operations.filter(operation => operation.operationId !== expected.operationId); operationOptions();
          error.message = `${error.message}。目标尚未开始复制，请重新检查条件。`;
        }
        throw error;
      }
    });
  }
  async function resume() {
    return run(async () => {
      if (!recovery) throw Error('没有待核对的副本记录。');
      const current = recovery; invalidate(); byId('status').textContent = '正在核对已有副本…';
      const data = await request('conversation-resume', { deviceId: current.target.deviceId, operationId: current.operationId }); acceptResult(data, current);
    });
  }
  byId('source').addEventListener('change', () => { revision++; invalidate(); return listConversations(); });
  byId('target').addEventListener('change', () => { revision++; invalidate(); return listOperations(); });
  byId('operations').addEventListener('change', () => {
    if (busy) return; revision++; invalidate();
    const operation = operations.find(value => value.operationId === byId('operations').value), target = selectedProject('target');
    if (operation && target) recovery = { operationId: operation.operationId, target: { deviceId: target.deviceId, path: target.path }, threadId: operation.sourceThreadId };
    recoveryView();
  });
  for (const name of ['thread', 'note']) byId(name).addEventListener(name === 'note' ? 'input' : 'change', () => { revision++; invalidate(); });
  for (const [name, action] of [['refresh', refresh], ['check', preflight], ['copy', execute], ['resume', resume]]) byId(name).addEventListener('click', action);
  recoveryView(); invalidate(); const ready = refresh();
  return { ready, refresh, preflight, execute, resume, listOperations,
    getState: () => ({ busy, canExecute: Boolean(permit && permit.revision === revision && Date.parse(permit.expiresAt) > now()), recovery, result,
      preview: permit ? { source: permit.source, target: permit.target, thread: permit.thread, expiresAt: permit.expiresAt, operationId: permit.operationId } : null }),
    dispose() { disposed = true; invalidate(); for (const controller of controllers) controller.abort(); controllers.clear(); } };
}
if (typeof document !== 'undefined') mountConversationCopy();
