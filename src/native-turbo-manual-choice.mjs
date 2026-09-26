// Tracks a user's native model/reasoning choice per conversation.  This file is
// deliberately dependency-free because its function source is injected into the
// renderer together with the Turbo integration.
export function installNativeTurboManualChoice({ hostWindow, documentRef, storage, readThreadId, isEnabled, onChange, now = Date.now }) {
  const key = "codex-control-console.turbo-manual-choice.v1";
  const validId = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ""));
  const idOf = (value) => validId(value) ? String(value).toLowerCase() : null;
  const enabled = () => typeof isEnabled !== "function" || isEnabled() !== false;
  const emit = () => { try { onChange?.(); } catch {} };
  const normalizeModel = (value) => {
    const text = String(value || "").trim().toLowerCase().replace(/[–—_]/g, "-").replace(/\s+/g, " ");
    if (!text) return null;
    const compact = text.replace(/^gpt[-\s]?/, "").replace(/[\s-]+/g, "-").replace(/^-|-$/g, "");
    return compact ? `gpt-${compact}` : null;
  };
  const effortOf = (value) => {
    const effort = String(value || "").trim().toLowerCase();
    return /^[a-z][a-z0-9_-]{0,31}$/.test(effort) ? effort : null;
  };
  let records = new Map();
  let pending = null;
  let draftIntent = false;
  let draftSubmitted = false;
  let revision = 0;
  let pickerOpen = false;
  let modelPickerOpen = false;
  let timer = null;
  let observed = { threadId: null, settings: { model: null, effort: null } };
  let disposed = false;

  function parsedRecords(value) {
    try {
      return new Map((Array.isArray(value) ? value : []).filter((item) => idOf(item?.threadId)).map((item) => [idOf(item.threadId), { threadId: idOf(item.threadId), at: Number(item.at) || 0 }]));
    } catch { return new Map(); }
  }
  function cap(map) { return new Map(Array.from(map.values()).sort((left, right) => left.at - right.at || left.threadId.localeCompare(right.threadId)).slice(-256).map((item) => [item.threadId, item])); }
  function load() {
    try { records = cap(parsedRecords(JSON.parse(storage?.getItem?.(key) || "[]"))); } catch { records = new Map(); }
  }
  function persist() {
    try {
      const stored = parsedRecords(JSON.parse(storage?.getItem?.(key) || "[]"));
      for (const item of records.values()) if (!stored.has(item.threadId) || stored.get(item.threadId).at < item.at) stored.set(item.threadId, item);
      records = cap(stored);
      const serialized = JSON.stringify(Array.from(records.values()));
      if (storage?.getItem?.(key) !== serialized) storage?.setItem?.(key, serialized);
    } catch {}
  }
  function changed() { revision += 1; emit(); }
  function clearTimer() { if (timer !== null) { (hostWindow?.clearTimeout || clearTimeout)(timer); timer = null; } }
  function expirePending() {
    if (!disposed && pending && now() - pending.at >= 5000) { pending = null; clearTimer(); changed(); }
  }
  function clearPending() {
    const wasSet = Boolean(pending); pending = null; pickerOpen = false; modelPickerOpen = false; clearTimer();
    if (wasSet && !disposed) changed();
  }
  function clearDraft() {
    const wasSet = draftIntent || draftSubmitted || pending?.threadId === null;
    if (pending?.threadId === null) { pending = null; clearTimer(); }
    draftIntent = false; draftSubmitted = false;
    if (wasSet) changed();
  }
  function readSettings() {
    const trigger = documentRef?.querySelector?.('button[data-composer-navigation-target="reasoning"]');
    if (!trigger) return { model: null, effort: null };
    const labels = Array.from(trigger.querySelectorAll?.("span") || []).filter((node) => !node.closest?.("[data-codex-control-console-turbo-effective]")).map((node) => normalizeModel(node.textContent)).filter(Boolean);
    return { model: labels[0] || null, effort: effortOf(trigger.getAttribute?.("data-selected-reasoning-effort")) };
  }
  function currentId() { return idOf(typeof readThreadId === "function" ? readThreadId() : null); }
  function matchesChange(before, after, fields) {
    return (fields.model && after.model && after.model !== before.model) || (fields.effort && after.effort && after.effort !== before.effort);
  }
  function confirm(change) {
    expirePending();
    if (!pending || !matchesChange(pending.before, change, pending.fields) || (pending.expectedModel && change.model !== pending.expectedModel)) return false;
    const id = pending.threadId;
    pending = null; clearTimer();
    if (!id) { draftIntent = true; changed(); return true; }
    if (!records.has(id)) { records.set(id, { threadId: id, at: now() }); persist(); }
    changed();
    return true;
  }
  function scheduleRefresh() {
    const defer = hostWindow?.queueMicrotask || globalThis.queueMicrotask;
    if (typeof defer === "function") defer(() => { if (!disposed) refresh(); }); else (hostWindow?.setTimeout || setTimeout)(() => { if (!disposed) refresh(); }, 0);
  }
  function begin(fields, expectedModel = null) {
    if (disposed || !enabled()) return;
    expirePending();
    const threadId = currentId();
    if (pending?.threadId === threadId && ((fields.model && pending.fields.model && pending.expectedModel === expectedModel) || (fields.effort && pending.fields.effort))) { scheduleRefresh(); return; }
    const before = observed.threadId === threadId ? observed.settings : readSettings();
    pending = { threadId, before, fields, expectedModel, at: now() };
    changed();
    clearTimer();
    timer = (hostWindow?.setTimeout || setTimeout)(() => expirePending(), 5100);
    scheduleRefresh();
  }
  function trusted(event) { return event?.isTrusted === true; }
  function closest(target, selector) { return target?.closest?.(selector) || null; }
  function isModelOption(target) { return Boolean(closest(target, '[role="menuitemradio"]')); }
  function isSlider(target) { return Boolean(closest(target, "[data-reasoning-slider]")); }
  function isReasoningButton(target) { return Boolean(closest(target, 'button[data-composer-navigation-target="reasoning"]')); }
  function isModelToggle(target) { return Boolean(closest(target, '[data-model-picker-view-toggle]')); }
  function onInteraction(event) {
    if (disposed || !trusted(event)) return;
    if (event.type === "keydown" && event.key === "Escape") { pickerOpen = false; modelPickerOpen = false; return; }
    if (isReasoningButton(event.target)) { refresh(); pickerOpen = true; modelPickerOpen = false; return; }
    if (isModelToggle(event.target)) { if (pickerOpen) modelPickerOpen = true; return; }
    if (isModelOption(event.target)) {
      const selecting = event.type === "pointerdown" || event.type === "click" || (event.type === "keydown" && ["Enter", " ", "Spacebar"].includes(event.key));
      const selected = normalizeModel(closest(event.target, '[role="menuitemradio"]')?.textContent);
      if (selecting && pickerOpen && modelPickerOpen && selected && selected !== readSettings().model) begin({ model: true }, selected);
      if (selecting) { pickerOpen = false; modelPickerOpen = false; }
      return;
    }
    if (!isSlider(event.target)) { if (["pointerdown", "click"].includes(event.type)) { pickerOpen = false; modelPickerOpen = false; } return; }
    if (["input", "change", "pointerdown", "click"].includes(event.type)) begin({ effort: true });
    else if (event.type === "keydown" && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "Enter", " ", "Spacebar"].includes(event.key)) begin({ effort: true });
  }
  function notification(data) {
    const value = data?.type === "mcp-notification" ? data : data?.data?.type === "mcp-notification" ? data.data : null;
    if (!value) return;
    if (value.hostId !== "local") return;
    const request = value.request && typeof value.request === "object" ? value.request : value;
    const method = request.method || value.method;
    const params = request.params || value.params || {};
    const threadId = idOf(params.threadId || params.thread?.id);
    if ((method === "thread/started" || method === "turn/started") && draftSubmitted && threadId && currentId() === threadId) { claimDraft(threadId); return; }
    if (method !== "thread/settings/updated" || !pending || pending.threadId !== threadId || currentId() !== threadId) return;
    const settings = params.threadSettings || params.settings || {};
    const collaboration = settings.collaborationMode || settings.collaboration_mode || params.collaborationMode || {};
    const collaborationSettings = collaboration.settings || {};
    const actual = {
      model: normalizeModel(collaborationSettings.model ?? settings.model),
      effort: effortOf(collaborationSettings.effort ?? collaborationSettings.reasoningEffort ?? collaborationSettings.reasoning_effort ?? settings.effort ?? settings.reasoningEffort ?? settings.reasoning_effort)
    };
    if (matchesChange(pending.before, actual, pending.fields)) confirm(actual);
  }
  function onNavigation(event) {
    if (trusted(event) && closest(event.target, "[data-app-action-sidebar-thread-id]")) { clearPending(); clearDraft(); }
  }
  function onSend(event) {
    if (!trusted(event) || !draftIntent) return;
    const button = closest(event.target, "button");
    const clicked = event.type === "click" && button && /^(send|发送)$/i.test(String(button.getAttribute?.("aria-label") || button.textContent || "").trim());
    const entered = event.type === "keydown" && event.key === "Enter" && !event.shiftKey && !event.isComposing && Boolean(closest(event.target, '[contenteditable="true"],textarea'));
    if (clicked || entered) submitDraft();
  }
  function onRoute(event) {
    const value = event?.data;
    if (value?.type === "navigate-to-route") { clearPending(); clearDraft(); }
  }
  function refresh() {
    if (disposed) return has(currentId());
    expirePending();
    const id = currentId();
    if (draftSubmitted && id) claimDraft(id);
    if (observed.threadId !== id) clearPending();
    const actual = readSettings();
    if (pending && pending.threadId === id) confirm(actual);
    observed = { threadId: id, settings: actual };
    return blocks(id);
  }
  function claimDraft(threadId) {
    const id = idOf(threadId);
    if (!id || !draftIntent || !draftSubmitted) return false;
    const current = currentId();
    if (current && current !== id) return false;
    draftIntent = false; draftSubmitted = false;
    if (!records.has(id)) { records.set(id, { threadId: id, at: now() }); persist(); }
    changed(); return true;
  }
  function submitDraft() {
    if (currentId() || !draftIntent || draftSubmitted) return false;
    draftSubmitted = true; changed(); return true;
  }
  function has(threadId) { const id = idOf(threadId); return id ? records.has(id) : draftIntent; }
  function blocks(threadId) {
    expirePending();
    const id = idOf(threadId);
    return has(id) || Boolean(pending && pending.threadId === id);
  }
  function onStorage(event) {
    if (event?.key !== key) return;
    const previous = JSON.stringify(Array.from(records.keys()));
    try {
      for (const item of parsedRecords(JSON.parse(event.newValue || '[]')).values()) if (!records.has(item.threadId) || records.get(item.threadId).at < item.at) records.set(item.threadId, item);
    } catch {}
    records = cap(records); persist();
    if (previous !== JSON.stringify(Array.from(records.keys()))) changed();
  }
  load();
  const events = ["pointerdown", "click", "keydown", "input", "change"];
  for (const type of events) documentRef?.addEventListener?.(type, onInteraction, true);
  documentRef?.addEventListener?.("click", onNavigation, true);
  documentRef?.addEventListener?.("click", onSend, true);
  documentRef?.addEventListener?.("keydown", onSend, true);
  hostWindow?.addEventListener?.("message", notification);
  hostWindow?.addEventListener?.("message", onRoute);
  hostWindow?.addEventListener?.("storage", onStorage);
  const Observer = hostWindow?.MutationObserver || (typeof MutationObserver === "function" ? MutationObserver : null);
  const observer = Observer && documentRef?.body ? new Observer(() => { if (!disposed) refresh(); }) : null;
  observer?.observe?.(documentRef.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-selected-reasoning-effort"] });
  return {
    has, blocks, refresh, claimDraft, submitDraft,
    get revision() { return revision; },
    cleanup() {
      disposed = true; clearPending(); observer?.disconnect?.();
      for (const type of events) documentRef?.removeEventListener?.(type, onInteraction, true);
      documentRef?.removeEventListener?.("click", onNavigation, true); documentRef?.removeEventListener?.("click", onSend, true); documentRef?.removeEventListener?.("keydown", onSend, true);
      hostWindow?.removeEventListener?.("message", notification); hostWindow?.removeEventListener?.("message", onRoute); hostWindow?.removeEventListener?.("storage", onStorage);
    }
  };
}
