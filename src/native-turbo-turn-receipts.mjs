// Renderer boundary: accepts normalized settings callbacks; owns only bounded
// receipt metadata, never message content or native conversation state.
export function installNativeTurboTurnReceipts({ hostWindow, storage, normalizeReceipt, readVerifiedSettings, onChange, now = Date.now }) {
  const storageKey = "codex-control-console.turbo-turn-receipts.v1";
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const pending = new Map();
  const observed = new Set();
  const invalidated = new WeakSet();
  let receipts = [];
  const keyFor = (value) => value.threadId + ":" + value.turnId;

  function merge(raw) {
    let entries;
    try { entries = JSON.parse(raw || "[]"); } catch { return; }
    const existing = new Map(receipts.map((entry) => [keyFor(entry), entry]));
    for (const entry of Array.isArray(entries) ? entries.slice(-512) : []) {
      const receipt = normalizeReceipt(entry);
      if (receipt && !existing.has(keyFor(receipt))) existing.set(keyFor(receipt), receipt);
    }
    receipts = [...existing.values()].sort((left, right) => left.recordedAt - right.recordedAt).slice(-512);
  }

  function readStorage() { try { merge(storage.getItem(storageKey)); } catch {} }
  readStorage();

  function remember(value) {
    const receipt = normalizeReceipt(value);
    if (!receipt) return;
    readStorage();
    if (receipts.some((entry) => keyFor(entry) === keyFor(receipt))) return;
    receipts = [...receipts, receipt].slice(-512);
    try { storage.setItem(storageKey, JSON.stringify(receipts)); } catch {}
    onChange();
  }

  function prunePending() {
    for (const [id, entry] of pending) if (now() - entry.dispatchedAt > 300000) pending.delete(id);
    while (pending.size > 64) pending.delete(pending.keys().next().value);
  }

  function trackRequest(id, snapshot) {
    if ((typeof id !== "string" && typeof id !== "number") || !snapshot) return () => {};
    const entry = { ...snapshot, dispatchedAt: now() };
    pending.set(String(id), entry);
    prunePending();
    return () => { if (pending.get(String(id)) === entry) pending.delete(String(id)); };
  }

  function receive(event) {
    const data = event.data;
    if (data?.hostId !== "local") return;
    prunePending();
    if (data.type === "mcp-response") {
      const id = String(data.message?.id), snapshot = pending.get(id);
      if (!snapshot) return;
      pending.delete(id);
      if (data.message.error || (data.requestMethod && data.requestMethod !== "turn/start")) return;
      const result = data.message.result;
      if (result?.threadId && result.threadId !== snapshot.threadId) return;
      remember({ ...snapshot, turnId: result?.turn?.id, recordedAt: snapshot.dispatchedAt });
      return;
    }
    if (data.type !== "mcp-notification") return;
    const notification = data.method ? data : data.request;
    const params = notification?.params;
    const threadId = String(params?.threadId || "").toLowerCase();
    if (!uuid.test(threadId)) return;
    if (notification.method === "thread/settings/updated") {
      const verified = readVerifiedSettings(threadId), settings = params.threadSettings;
      if (!verified || !settings) return;
      const model = settings.collaborationMode?.settings?.model ?? settings.model;
      const effort = settings.collaborationMode?.settings?.reasoning_effort ?? settings.effort;
      if ((model != null && model !== verified.model) || (effort != null && effort !== verified.effort) || (settings.serviceTier != null && settings.serviceTier !== verified.serviceTier)) invalidated.add(verified);
      else if (model === verified.model && effort === verified.effort && settings.serviceTier === verified.serviceTier) invalidated.delete(verified);
      return;
    }
    if (notification.method !== "turn/started") return;
    const turnId = String(params.turn?.id || "").toLowerCase();
    if (!uuid.test(turnId)) return;
    const key = threadId + ":" + turnId;
    if (observed.has(key)) return;
    observed.add(key);
    if (observed.size > 1024) observed.delete(observed.values().next().value);
    const snapshot = readVerifiedSettings(threadId);
    if (snapshot && !invalidated.has(snapshot)) remember({ ...snapshot, threadId, turnId, source: "native-settings", recordedAt: now() });
  }

  function receiveStorage(event) {
    if (event.key !== storageKey) return;
    merge(event.newValue);
    onChange();
  }

  hostWindow.addEventListener("message", receive);
  hostWindow.addEventListener("storage", receiveStorage);
  return {
    getReceipts: () => receipts.slice(),
    trackRequest,
    cleanup() {
      hostWindow.removeEventListener("message", receive);
      hostWindow.removeEventListener("storage", receiveStorage);
      pending.clear(); observed.clear();
    }
  };
}
