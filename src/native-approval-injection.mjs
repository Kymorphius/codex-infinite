export function buildNativeApprovalInjectionScript() {
  return `(() => {
  if (window.__codexControlConsoleNativeApprovalVersion === '2026-08-31.1') return;
  window.__codexControlConsoleNativeApprovalVersion = '2026-08-31.1';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const METHODS = new Map([
    ['item/commandExecution/requestApproval', 'command'],
    ['item/fileChange/requestApproval', 'fileChange'],
    ['item/permissions/requestApproval', 'permissions']
  ]);
  const records = new Map();
  const requestTokens = new Map();
  const MAX_RECORDS = 32;
  const MAX_VISIBLE = 8;
  const MAX_AGE_MS = 6 * 60 * 60 * 1000;

  function clean(value, maxLength) {
    if (typeof value !== 'string') return null;
    const result = value.replace(/[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f]/g, '').trim();
    return result ? result.slice(0, maxLength) : null;
  }

  function requestKey(id) {
    if (typeof id === 'string' && id.length > 0 && id.length <= 200) return 's:' + id;
    if (Number.isSafeInteger(id)) return 'n:' + id;
    return null;
  }

  function cloneJson(value) {
    const json = JSON.stringify(value);
    if (!json || json.length > 65536) throw new Error('审批权限数据过大');
    return JSON.parse(json);
  }

  function pathLabel(path) {
    if (!path || typeof path !== 'object') return null;
    if (path.type === 'path') return clean(path.path, 300);
    if (path.type === 'glob_pattern') return clean(path.pattern, 300);
    if (path.type === 'special') {
      const value = path.value;
      if (value?.kind === 'project_roots') return value.subpath ? '项目目录/' + clean(value.subpath, 240) : '项目目录';
      if (typeof value?.kind === 'string') return clean(value.kind, 80);
    }
    return null;
  }

  function permissionSummary(profile) {
    const output = [];
    if (!profile || typeof profile !== 'object') return output;
    if (profile.network?.enabled === true) output.push('访问网络');
    const fileSystem = profile.fileSystem;
    for (const entry of Array.isArray(fileSystem?.entries) ? fileSystem.entries.slice(0, 10) : []) {
      const label = pathLabel(entry?.path);
      const access = entry?.access === 'write' ? '写入' : entry?.access === 'read' ? '读取' : entry?.access === 'deny' ? '禁止' : null;
      if (access && label) output.push((access + ' ' + label).slice(0, 400));
    }
    for (const [access, label] of [['read', '读取'], ['write', '写入']]) {
      for (const path of Array.isArray(fileSystem?.[access]) ? fileSystem[access].slice(0, 10) : []) {
        const value = clean(path, 300);
        if (value) output.push((label + ' ' + value).slice(0, 400));
      }
    }
    return [...new Set(output)].slice(0, 12);
  }

  function removeToken(token) {
    const record = records.get(token);
    if (!record) return;
    records.delete(token);
    requestTokens.delete(record.requestKey);
  }

  function prune(now = Date.now()) {
    for (const [token, record] of records) if (now - record.capturedAt > MAX_AGE_MS) removeToken(token);
    while (records.size > MAX_RECORDS) removeToken(records.keys().next().value);
  }

  function decisionsFor(method, params) {
    if (method !== 'item/commandExecution/requestApproval' || !Array.isArray(params.availableDecisions)) return ['accept', 'decline'];
    return ['accept', 'decline'].filter((decision) => params.availableDecisions.includes(decision));
  }

  function capture(request) {
    const baseKind = METHODS.get(request?.method);
    const params = request?.params;
    const key = requestKey(request?.id);
    if (!baseKind || !key || !params || !UUID.test(params.threadId) || !UUID.test(params.turnId)) return;
    if (typeof params.itemId !== 'string' || !params.itemId.trim() || params.itemId.length > 160) return;
    if (!Number.isSafeInteger(params.startedAtMs) || params.startedAtMs < 0 || requestTokens.has(key)) return;
    const decisions = decisionsFor(request.method, params);
    if (!decisions.length || typeof crypto?.randomUUID !== 'function') return;
    let storedPermissions = null;
    try {
      if (baseKind === 'permissions') storedPermissions = cloneJson(params.permissions);
    } catch { return; }
    const kind = baseKind === 'command' && params.kind === 'writeStdin' ? 'writeStdin' : baseKind;
    const summaries = permissionSummary(baseKind === 'permissions' ? params.permissions : params.additionalPermissions);
    if (baseKind === 'fileChange' && params.grantRoot) summaries.push(('写入 ' + clean(params.grantRoot, 300)).slice(0, 400));
    const token = crypto.randomUUID().toLowerCase();
    const projection = Object.freeze({
      token,
      kind,
      threadId: params.threadId.toLowerCase(),
      turnId: params.turnId.toLowerCase(),
      itemId: params.itemId.trim(),
      startedAtMs: params.startedAtMs,
      reason: clean(params.reason, 2000),
      command: baseKind === 'command' ? clean(params.command, 4000) : null,
      cwd: clean(params.cwd, 1000),
      networkHost: clean(params.networkApprovalContext?.host, 512),
      permissionSummary: Object.freeze(summaries.slice(0, 12)),
      decisions: Object.freeze(decisions)
    });
    records.set(token, { token, requestKey: key, requestId: request.id, method: request.method, projection, permissions: storedPermissions, capturedAt: Date.now(), resolving: false });
    requestTokens.set(key, token);
    prune();
  }

  function removeMatching(predicate) {
    for (const [token, record] of records) if (predicate(record)) removeToken(token);
  }

  function receive(event) {
    const data = event?.data;
    if (!data || data.hostId !== 'local') return;
    if (data.type === 'mcp-request') {
      capture(data.request);
      return;
    }
    if (data.type !== 'mcp-notification') return;
    const notification = data.request;
    const params = notification?.params;
    if (notification?.method === 'serverRequest/resolved') {
      const key = requestKey(params?.requestId);
      if (key && requestTokens.has(key)) removeToken(requestTokens.get(key));
    } else if (notification?.method === 'item/completed') {
      removeMatching((record) => record.projection.threadId === String(params?.threadId || '').toLowerCase()
        && record.projection.turnId === String(params?.turnId || '').toLowerCase()
        && record.projection.itemId === params?.item?.id);
    } else if (notification?.method === 'turn/completed') {
      removeMatching((record) => record.projection.threadId === String(params?.threadId || '').toLowerCase()
        && record.projection.turnId === String(params?.turn?.id || '').toLowerCase());
    }
  }

  window.addEventListener('message', receive);

  window.__codexControlConsoleReadPendingApprovals = (threadId) => {
    const normalized = String(threadId || '').trim().toLowerCase();
    if (!UUID.test(normalized)) return [];
    prune();
    return [...records.values()]
      .filter((record) => record.projection.threadId === normalized && !record.resolving)
      .sort((left, right) => left.projection.startedAtMs - right.projection.startedAtMs)
      .slice(0, MAX_VISIBLE)
      .map((record) => record.projection);
  };

  window.__codexControlConsoleResolveApproval = async (threadId, turnId, token, decision) => {
    prune();
    const normalizedThread = String(threadId || '').trim().toLowerCase();
    const normalizedTurn = String(turnId || '').trim().toLowerCase();
    const normalizedToken = String(token || '').trim().toLowerCase();
    const record = records.get(normalizedToken);
    if (!record || record.resolving || record.projection.threadId !== normalizedThread || record.projection.turnId !== normalizedTurn) {
      throw new Error('这个审批已经失效或不属于当前会话');
    }
    if (!record.projection.decisions.includes(decision)) throw new Error('这个审批不支持该操作');
    const bridge = window.electronBridge?.sendMessageFromView;
    if (typeof bridge !== 'function') throw new Error('所属节点的原生审批服务尚未就绪');
    let result;
    if (record.method === 'item/permissions/requestApproval') {
      result = { permissions: decision === 'accept' ? record.permissions : {}, scope: 'turn' };
    } else {
      result = { decision };
    }
    record.resolving = true;
    try {
      await Promise.resolve(bridge.call(window.electronBridge, {
        type: 'mcp-response', hostId: 'local', response: { id: record.requestId, result }
      }));
      removeToken(normalizedToken);
      return { accepted: true, threadId: normalizedThread, turnId: normalizedTurn, decision };
    } catch (error) {
      record.resolving = false;
      throw error;
    }
  };
})();`;
}
