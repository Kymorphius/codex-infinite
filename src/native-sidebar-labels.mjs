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
  return `(() => {
    window.__codexControlConsoleSidebarLabelObserver?.disconnect?.();
    window.__codexControlConsoleSidebarLabelObserver = null;
    window.__codexControlConsoleSidebarLabelVersion = '2026-09-28-removed';
    document.getElementById('codex-control-console-sidebar-label-style')?.remove();
    document.querySelectorAll('[data-codex-control-console-sidebar-labels]').forEach((node) => node.remove());
    document.querySelectorAll('[data-codex-control-console-sidebar-label-host]').forEach((node) => {
      node.removeAttribute('data-codex-control-console-sidebar-label-host');
      node.removeAttribute('data-codex-control-console-project-label');
      node.removeAttribute('data-codex-control-console-device-label');
      node.removeAttribute('data-codex-control-console-label-signature');
      node.removeAttribute('data-codex-control-console-label-layout');
    });
    window.__codexControlConsoleSetSidebarLabels = () => ({ count: 0 });
  })()`;
}
