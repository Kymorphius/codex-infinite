import { filterProjects, pinTarget, projectAction, projectCatalog, validateCatalogPayload } from './model.js';
import { createProjectView } from './view.js';

export function createProjectController({ fetchImpl = fetch, render = () => {}, notice = () => {}, onLocalOpen = () => {}, copyText, requestTimeoutMs = 15000 } = {}) {
  const state = { payload: null, filters: { query: '', device: '', source: '', section: '', sort: 'native' },
    loading: false, busy: null, stale: false, readError: '' };
  let readVersion = 0, disposed = false;
  const projected = () => {
    const catalog = projectCatalog(state.payload, { stale: state.stale });
    return { ...state, catalog, visible: filterProjects(catalog.projects, state.filters) };
  };
  const publish = () => { if (!disposed) render(projected()); };
  function acceptPayload(payload) {
    const catalog = projectCatalog(payload);
    state.payload = payload;
    if (state.filters.device && !catalog.devices.some(owner => owner.device.id === state.filters.device)) state.filters.device = '';
    if (state.filters.section && !catalog.sections.some(section => section.filterId === state.filters.section)) state.filters.section = '';
  }
  async function responseBody(response) {
    let body;
    try { body = await response.json(); } catch { throw Error('服务未返回有效数据'); }
    if (!response.ok) throw Object.assign(Error(body.message || '项目服务暂不可用'), { status: response.status });
    return body;
  }
  async function request(path, options = {}) {
    const aborter = new AbortController();
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(() => fetchImpl(path, { ...options, signal: aborter.signal })).then(responseBody),
        new Promise((_, reject) => { timer = setTimeout(() => { aborter.abort(); reject(Error('请求超时，所属设备可能尚未就绪')); }, requestTimeoutMs); })
      ]);
    } finally { clearTimeout(timer); }
  }
  async function refresh() {
    if (disposed || state.busy) return false;
    const version = ++readVersion;
    state.loading = true; publish();
    try {
      const payload = validateCatalogPayload(await request('/api/sidebar', { cache: 'no-store' }));
      if (disposed || version !== readVersion) return false;
      acceptPayload(payload); state.stale = false; state.readError = '';
      return true;
    } catch (error) {
      if (disposed || version !== readVersion) return false;
      state.readError = error.message || '项目列表读取失败'; state.stale = true;
      return false;
    } finally {
      if (!disposed && version === readVersion) { state.loading = false; publish(); }
    }
  }
  function setFilters(patch) { state.filters = { ...state.filters, ...patch }; publish(); }
  async function act(identity, requestedAction, targetSectionId) {
    if (disposed || state.busy) return false;
    const project = projected().catalog.projects.find(item => item.identity === identity);
    if (!project) { notice('项目列表已变化，请刷新后重试', true); return false; }
    if (requestedAction === 'copy') {
      try {
        if (!project.sourceDirectories.length) throw Error('此项目没有可复制的路径');
        if (!copyText) throw Error('当前环境无法使用剪贴板，请从卡片选取路径复制');
        await copyText(project.sourceDirectories.join('\n')); notice('项目路径已复制'); return true;
      } catch (error) { notice(error.message || '复制失败，请从卡片选取路径复制', true); return false; }
    }
    let input;
    try { input = projectAction(project, requestedAction === 'pin' ? 'item-move' : requestedAction,
      requestedAction === 'pin' ? pinTarget(project)?.id : targetSectionId); }
    catch (error) { notice(error.message, true); return false; }
    ++readVersion; state.loading = false; state.busy = identity; publish(); notice('正在等待所属设备确认…');
    let applied = false;
    try {
      const result = await request('/api/sidebar/actions', { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
      if (disposed) return false;
      if (!result.applied || result.deviceId !== project.deviceId || !result.snapshot) throw Error('所属设备未确认操作，请刷新核对');
      const payload = validateCatalogPayload({ ...state.payload, devices: state.payload.devices.map(owner => owner.device.id === project.deviceId
        ? { ...owner, snapshot: result.snapshot, status: 'connected', message: null } : owner) });
      acceptPayload(payload);
      applied = true;
      if (input.action === 'open') {
        if (project.deviceKind === 'local-codex') { notice(`已打开「${project.name}」`); onLocalOpen(project); }
        else notice(`已在 ${project.deviceName} 打开「${project.name}」`);
      } else {
        const target = project.sections.find(section => section.id === input.targetSectionId);
        notice(`「${project.name}」已移到「${target.name}」`);
      }
      return true;
    } catch (error) {
      if (!disposed) {
        state.stale = true;
        notice(error.status === 409 ? `${error.message}。正在刷新，请核对后重试。` : `${error.message || '操作未确认'}。正在刷新列表，请核对结果。`, true);
      }
      return false;
    } finally {
      state.busy = null; publish();
      if (!applied && !disposed) await refresh();
    }
  }
  return { refresh, setFilters, act, getState: projected, dispose() { disposed = true; ++readVersion; } };
}

export function mountProjects({ documentRef = document, windowRef = window, fetchImpl = fetch } = {}) {
  const view = createProjectView(documentRef), embedded = windowRef.parent !== windowRef;
  const close = () => windowRef.parent.postMessage({ type: 'codex-control-console-close' }, 'app://-');
  const controller = createProjectController({ fetchImpl, ...view,
    onLocalOpen: () => { if (embedded) close(); },
    copyText: windowRef.navigator.clipboard?.writeText ? text => windowRef.navigator.clipboard.writeText(text) : null });
  const $ = selector => documentRef.querySelector(selector);
  $('#search').addEventListener('input', event => controller.setFilters({ query: event.target.value }));
  for (const key of ['device', 'source', 'section', 'sort']) $(`#${key}`).addEventListener('change', event => controller.setFilters({ [key]: event.target.value }));
  $('#clear').addEventListener('click', () => { controller.setFilters({ query: '', device: '', source: '', section: '' }); $('#search').focus(); });
  $('#refresh').addEventListener('click', () => void controller.refresh());
  $('#back').addEventListener('click', event => { if (embedded) { event.preventDefault(); close(); } });
  $('#project-grid').addEventListener('click', event => {
    const button = event.target.closest('[data-project-action]');
    if (button && !button.disabled) void controller.act(button.closest('[data-project-id]').dataset.projectId, button.dataset.projectAction);
  });
  $('#project-grid').addEventListener('change', async event => {
    const select = event.target.closest('.move-project');
    if (select?.value && !select.disabled) {
      const target = select.value; select.value = '';
      await controller.act(select.closest('[data-project-id]').dataset.projectId, 'item-move', target);
    }
  });
  if (embedded) windowRef.parent.postMessage({ type: 'codex-control-console-ready' }, 'app://-');
  void controller.refresh();
  const timer = windowRef.setInterval(() => { if (documentRef.visibilityState === 'visible' && !controller.getState().loading) void controller.refresh(); }, 5000);
  documentRef.addEventListener('visibilitychange', () => { if (documentRef.visibilityState === 'visible') void controller.refresh(); });
  windowRef.addEventListener('pagehide', () => { windowRef.clearInterval(timer); controller.dispose(); }, { once: true });
  return controller;
}

if (typeof document !== 'undefined') mountProjects();
