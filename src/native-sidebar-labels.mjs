const THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LABELS = 800;

function boundedText(value, maxLength) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, maxLength);
}

export function projectNativeSidebarLabels(result = {}) {
  const labels = new Map();
  for (const task of Array.isArray(result.tasks) ? result.tasks : []) {
    const threadId = boundedText(task?.id, 160).toLowerCase();
    if (!THREAD_ID_PATTERN.test(threadId)) continue;
    const projectLabel = boundedText(task?.projectDisplayName || task?.project, 80);
    const deviceLabel = task?.device?.kind === "local-codex"
      ? "本地"
      : boundedText(task?.device?.name, 80) || "远端";
    if (!projectLabel || !deviceLabel) continue;
    labels.set(threadId, Object.freeze({ threadId, projectLabel, deviceLabel }));
    if (labels.size >= MAX_LABELS) break;
  }
  return Object.freeze([...labels.values()]);
}

export function normalizeNativeSidebarLabelItems(items = []) {
  const labels = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const threadId = boundedText(item?.threadId, 160).toLowerCase();
    const projectLabel = boundedText(item?.projectLabel, 80);
    const deviceLabel = boundedText(item?.deviceLabel, 80);
    if (!THREAD_ID_PATTERN.test(threadId) || !projectLabel || !deviceLabel) continue;
    labels.set(threadId, Object.freeze({ threadId, projectLabel, deviceLabel }));
    if (labels.size >= MAX_LABELS) break;
  }
  return Object.freeze([...labels.values()]);
}

function directoryName(value) {
  const clean = String(value || "").replace(/[\\/]+$/, "");
  return clean.split(/[\\/]/).pop() || "";
}

export function projectCurrentNativeSidebarLabels(lookup, deviceLabel = "本地") {
  return normalizeNativeSidebarLabelItems((lookup?.entries?.() || []).map((entry) => ({
    threadId: entry.threadId,
    projectLabel: entry.projectName || directoryName(entry.cwd),
    deviceLabel
  })));
}

function mergeNativeSidebarLabels(...snapshots) {
  const merged = new Map();
  for (const snapshot of snapshots) {
    for (const item of normalizeNativeSidebarLabelItems(snapshot)) {
      // A later snapshot is more authoritative. Refresh its insertion order as
      // well as its value so the bounded tail cannot discard recently
      // confirmed local rows merely because they also existed in federation.
      merged.delete(item.threadId);
      merged.set(item.threadId, item);
    }
  }
  return Object.freeze([...merged.values()].slice(-MAX_LABELS));
}

export class NativeSidebarLabelService {
  constructor({ adapter, localAdapter = adapter, currentThreadProjectIndex = null, cacheMs = 5_000, clock = () => Date.now() } = {}) {
    this.adapter = adapter;
    this.localAdapter = localAdapter;
    this.currentThreadProjectIndex = currentThreadProjectIndex;
    this.cacheMs = cacheMs;
    this.clock = clock;
    this.snapshot = Object.freeze([]);
    this.refreshedAt = 0;
    this.refreshing = null;
  }

  async read() {
    const now = this.clock();
    if (this.refreshedAt && now - this.refreshedAt < this.cacheMs) return this.snapshot;
    if (this.refreshing) return this.refreshing;
    const primaryAdapter = this.localAdapter || this.adapter;
    this.refreshing = Promise.all([
      Promise.resolve(primaryAdapter?.listTasks?.()),
      Promise.resolve(this.currentThreadProjectIndex?.readAll?.()).catch(() => null)
    ])
      .then(([result, currentThreads]) => {
        const indexed = projectNativeSidebarLabels(result);
        const current = projectCurrentNativeSidebarLabels(currentThreads);
        this.snapshot = mergeNativeSidebarLabels(this.snapshot, indexed, current);
        this.refreshedAt = this.clock();
        return this.snapshot;
      })
      .catch(() => this.snapshot)
      .finally(() => { this.refreshing = null; });
    const localSnapshot = await this.refreshing;
    if (this.adapter && this.adapter !== primaryAdapter) void this.refreshFederated();
    return localSnapshot;
  }

  async refreshFederated() {
    if (this.refreshing) return this.refreshing;
    this.refreshing = Promise.all([
      Promise.resolve(this.adapter?.listTasks?.()),
      Promise.resolve(this.currentThreadProjectIndex?.readAll?.()).catch(() => null)
    ])
      .then(([result, currentThreads]) => {
        const snapshot = projectNativeSidebarLabels(result);
        const current = projectCurrentNativeSidebarLabels(currentThreads);
        if (snapshot.length || current.length) this.snapshot = mergeNativeSidebarLabels(snapshot, current);
        this.refreshedAt = this.clock();
        return this.snapshot;
      })
      .catch(() => this.snapshot)
      .finally(() => { this.refreshing = null; });
    return this.refreshing;
  }
}

export function buildNativeSidebarLabelsSnapshotScript(items = []) {
  return `window.__codexControlConsoleSetSidebarLabels?.(${JSON.stringify(normalizeNativeSidebarLabelItems(items))})`;
}

export function buildNativeSidebarLabelsInjectionScript() {
  const stylesheet = [
    '[data-codex-control-console-sidebar-label-host]::before,[data-codex-control-console-sidebar-label-host]::after{display:inline-block;box-sizing:border-box;flex:0 1 auto;overflow:hidden;min-width:36px;padding:1px 5px;border-radius:999px;color:currentColor;font:500 10px/14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;text-overflow:ellipsis;white-space:nowrap;opacity:.82;pointer-events:none;}',
    '[data-codex-control-console-sidebar-label-host]::before{content:attr(data-codex-control-console-project-label) / "";order:100;max-width:64px;margin-left:auto;border:1px solid rgba(92,116,170,.28);background:rgba(92,116,170,.1);}',
    '[data-codex-control-console-sidebar-label-host]::after{content:attr(data-codex-control-console-device-label) / "";order:101;max-width:58px;margin-left:3px;border:1px solid rgba(93,145,112,.3);background:rgba(93,145,112,.11);}'
  ].join('');
  return `(() => {
  const VERSION = '2026-09-07.1';
  const LAYOUT_VERSION = 'generated-labels-v2';
  const THREAD_SELECTOR = '[data-app-action-sidebar-thread-id]';
  const LABEL_SELECTOR = '[data-codex-control-console-sidebar-labels]';
  const HOST_SELECTOR = '[data-codex-control-console-sidebar-label-host]';
  const STYLE_ID = 'codex-control-console-sidebar-label-style';
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (window.__codexControlConsoleSidebarLabelVersion === VERSION && window.__codexControlConsoleSidebarLabelObserver) return;
  window.__codexControlConsoleSidebarLabelObserver?.disconnect?.();
  document.querySelectorAll(LABEL_SELECTOR).forEach((element) => element.remove());
  document.querySelectorAll(HOST_SELECTOR).forEach(clearHost);
  window.__codexControlConsoleSidebarLabelVersion = VERSION;
  const labels = new Map();
  let renderPending = false;

  function clearHost(host) {
    host.removeAttribute('data-codex-control-console-sidebar-label-host');
    host.removeAttribute('data-codex-control-console-project-label');
    host.removeAttribute('data-codex-control-console-device-label');
    host.removeAttribute('data-codex-control-console-label-signature');
    host.removeAttribute('data-codex-control-console-label-layout');
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = ${JSON.stringify(stylesheet)};
    (document.head || document.documentElement).append(style);
  }

  function text(value, maxLength) {
    return String(value || '').replace(/[\\u0000-\\u001f\\u007f]/g, '').trim().slice(0, maxLength);
  }

  function threadIdFor(element) {
    const value = element.getAttribute('data-app-action-sidebar-thread-id') || '';
    return value.match(UUID)?.[0]?.toLowerCase() || null;
  }

  function labelHost(marker) {
    const titleTrigger = marker.querySelector('[data-thread-title-trigger="true"]');
    const titleRow = titleTrigger?.parentElement;
    if (titleRow
      && titleRow !== marker
      && titleRow.classList.contains('flex')
      && titleRow.classList.contains('min-w-0')
      && titleRow.classList.contains('items-center')) return titleRow;
    return Array.from(marker.querySelectorAll('span')).find((node) => (
      node.classList.contains('flex')
      && node.classList.contains('min-w-0')
      && node.classList.contains('items-center')
      && node.getBoundingClientRect().height <= 24
    )) || null;
  }

  function render() {
    ensureStyle();
    for (const marker of document.querySelectorAll(THREAD_SELECTOR)) {
      const threadId = threadIdFor(marker);
      const value = threadId ? labels.get(threadId) : null;
      const host = labelHost(marker);
      marker.querySelectorAll(HOST_SELECTOR).forEach((candidate) => { if (candidate !== host || !value) clearHost(candidate); });
      marker.querySelectorAll(LABEL_SELECTOR).forEach((element) => element.remove());
      if (!value || !host) { if (host) clearHost(host); continue; }
      const signature = value.projectLabel + '\\n' + value.deviceLabel;
      if (host.getAttribute('data-codex-control-console-label-signature') === signature && host.getAttribute('data-codex-control-console-label-layout') === LAYOUT_VERSION) continue;
      host.setAttribute('data-codex-control-console-sidebar-label-host', '');
      host.setAttribute('data-codex-control-console-project-label', value.projectLabel);
      host.setAttribute('data-codex-control-console-device-label', value.deviceLabel);
      host.setAttribute('data-codex-control-console-label-signature', signature);
      host.setAttribute('data-codex-control-console-label-layout', LAYOUT_VERSION);
    }
  }

  function scheduleRender() {
    if (renderPending) return;
    renderPending = true;
    requestAnimationFrame(() => {
      renderPending = false;
      render();
    });
  }

  window.__codexControlConsoleSetSidebarLabels = (items) => {
    labels.clear();
    for (const item of Array.isArray(items) ? items.slice(0, ${MAX_LABELS}) : []) {
      const threadId = text(item?.threadId, 160).toLowerCase();
      const projectLabel = text(item?.projectLabel, 80);
      const deviceLabel = text(item?.deviceLabel, 80);
      if (UUID.test(threadId) && projectLabel && deviceLabel) labels.set(threadId, { projectLabel, deviceLabel });
    }
    scheduleRender();
    return { count: labels.size };
  };

  window.__codexControlConsoleSidebarLabelObserver = new MutationObserver(scheduleRender);
  window.__codexControlConsoleSidebarLabelObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-app-action-sidebar-thread-id'] });
  scheduleRender();
})()`;
}
