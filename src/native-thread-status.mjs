const THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS_MAP = Object.freeze({ active: "active", idle: "completed", systemError: "error" });

export function normalizeNativeThreadStatuses(items = []) {
  const statuses = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const id = String(item?.id || "").trim().toLowerCase();
    const status = STATUS_MAP[item?.status?.type];
    if (THREAD_ID_PATTERN.test(id) && status) statuses.set(id, status);
  }
  return statuses;
}

export const nativeThreadStatusExpression = `window.__codexControlConsoleReadThreadStatuses?.()`;

export class NativeThreadStatusProvider {
  constructor({ desktopBridge } = {}) {
    this.desktopBridge = desktopBridge;
  }

  async readThreadStatuses() {
    return this.desktopBridge?.readThreadStatuses().catch(() => new Map()) || new Map();
  }
}
