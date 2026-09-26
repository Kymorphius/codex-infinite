import { catalogProjects, selectionInput, selectionIssue, validateCatalog, validateExecution, validatePreflight } from './model.js';
import { createSyncView } from './view.js';

export function createSyncController({ fetchImpl = fetch, render = () => {}, requestTimeoutMs = 180000, now = Date.now } = {}) {
  const state = { catalog: null, sourceKey: '', targetKey: '', busy: null, stale: false, preflight: null, result: null, error: '', notice: '' };
  let version = 0, permit = null, expiryTimer, disposed = false;
  function projected() {
    const projects = catalogProjects(state.catalog);
    const source = projects.find(project => project.key === state.sourceKey), target = projects.find(project => project.key === state.targetKey);
    const issue = selectionIssue(source, target, state.stale);
    return { ...state, projects, source, target, issue, canPreflight: !state.busy && !issue,
      canExecute: !state.busy && !issue && Boolean(permit) && !permit.unchanged && Date.parse(permit.expiresAt) > now() };
  }
  const publish = () => { if (!disposed) render(projected()); };
  function invalidate() {
    ++version; clearTimeout(expiryTimer); permit = null; state.preflight = null; state.result = null;
  }
  async function request(path, body) {
    const aborter = new AbortController(); let timer;
    const writing = path.endsWith('/execute');
    try {
      return await Promise.race([
        Promise.resolve().then(() => fetchImpl(path, { cache: 'no-store', signal: aborter.signal,
          ...(body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {})
        })).then(async response => {
          let data;
          try { data = await response.json(); } catch { throw Error('服务未返回有效数据'); }
          if (!response.ok || (data.status && data.status !== 'ok')) throw Error(data.message || '项目同步服务暂不可用');
          return data;
        }),
        new Promise((_, reject) => { timer = setTimeout(() => {
          aborter.abort(); reject(Error(writing ? '同步请求超时，结果尚未确认。请刷新并重新预检核对目标状态；不会自动重试。' : '请求超时，设备可能尚未就绪。请稍后重试。'));
        }, requestTimeoutMs); })
      ]);
    } finally { clearTimeout(timer); }
  }
  async function refresh() {
    if (disposed || state.busy) return false;
    invalidate(); const current = version;
    state.busy = 'catalog'; state.notice = ''; state.error = ''; publish();
    try {
      const catalog = validateCatalog(await request('/api/project-sync/catalog'));
      if (disposed || current !== version) return false;
      state.catalog = catalog; state.stale = false;
      const keys = new Set(catalogProjects(catalog).map(project => project.key));
      if (!keys.has(state.sourceKey)) state.sourceKey = '';
      if (!keys.has(state.targetKey)) state.targetKey = '';
      return true;
    } catch (error) {
      if (!disposed && current === version) { state.stale = true; state.error = error.message || '读取项目列表失败'; }
      return false;
    } finally { if (!disposed && current === version) { state.busy = null; publish(); } }
  }
  function select(side, key) {
    if (disposed || !['source', 'target'].includes(side) || state.busy === 'execute') return false;
    if (state[`${side}Key`] === key) return true;
    const hadPreflight = Boolean(permit) || state.busy === 'preflight';
    invalidate(); state[`${side}Key`] = key; state.busy = null;
    state.notice = hadPreflight ? '选择已变化，请重新预检。' : ''; publish(); return true;
  }
  async function preflight() {
    if (disposed || state.busy) return false;
    const { source, target, issue } = projected();
    if (issue) { state.error = issue; publish(); return false; }
    invalidate(); const current = version;
    state.busy = 'preflight'; state.error = ''; state.notice = ''; publish();
    try {
      const payload = await request('/api/project-sync/preflight', { source: selectionInput(source), target: selectionInput(target) });
      if (disposed || current !== version) return false;
      permit = validatePreflight(payload, source, target, now());
      const { token, ...summary } = permit; state.preflight = summary;
      expiryTimer = setTimeout(() => {
        if (disposed || current !== version || state.busy === 'execute') return;
        invalidate(); state.notice = '预检已过期，请重新预检后同步。'; publish();
      }, Math.max(1, Date.parse(permit.expiresAt) - now()));
      expiryTimer?.unref?.();
      return true;
    } catch (error) {
      if (!disposed && current === version) state.error = error.message || '预检未通过';
      return false;
    } finally { if (!disposed && current === version) { state.busy = null; publish(); } }
  }
  async function execute() {
    if (disposed || state.busy) return false;
    if (!projected().canExecute) {
      if (permit?.unchanged) return false;
      invalidate(); state.error = '预检已失效，请重新预检后同步。'; publish(); return false;
    }
    const approved = permit; permit = null; clearTimeout(expiryTimer);
    const current = version; state.busy = 'execute'; state.error = ''; state.notice = ''; publish();
    try {
      const payload = await request('/api/project-sync/execute', { token: approved.token });
      if (disposed || current !== version) return false;
      state.result = validateExecution(payload, approved);
      state.preflight = null; state.notice = '目标设备已读回确认，项目代码同步完成。'; return true;
    } catch (error) {
      if (!disposed && current === version) {
        state.preflight = null; state.error = `${error.message || '同步结果未确认'}${/重新预检/.test(error.message || '') ? '' : '。请刷新并重新预检核对目标状态；不会自动重试。'}`;
      }
      return false;
    } finally { if (!disposed && current === version) { state.busy = null; publish(); } }
  }
  return { refresh, select, preflight, execute, getState: projected,
    dispose() { disposed = true; invalidate(); } };
}

export function mountProjectSync({ documentRef = document, windowRef = window, fetchImpl = fetch } = {}) {
  const controller = createSyncController({ fetchImpl, ...createSyncView(documentRef) });
  for (const side of ['source', 'target']) documentRef.querySelector(`#${side}`).addEventListener('change', event => controller.select(side, event.target.value));
  documentRef.querySelector('#refresh').addEventListener('click', () => void controller.refresh());
  documentRef.querySelector('#preflight').addEventListener('click', () => void controller.preflight());
  documentRef.querySelector('#execute').addEventListener('click', () => void controller.execute());
  if (windowRef.parent !== windowRef) windowRef.parent.postMessage({ type: 'codex-control-console-ready' }, 'app://-');
  windowRef.addEventListener('pagehide', () => controller.dispose(), { once: true });
  void controller.refresh(); return controller;
}

if (typeof document !== 'undefined') mountProjectSync();
