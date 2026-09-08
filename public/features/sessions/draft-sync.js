export function comparableDraftText(text) {
  return String(text || "").replace(/\r\n?/g, "\n").split("\n").map((line) => line.replace(/[ \t]+$/g, "")).filter((line) => line.trim()).join("\n").trim();
}

export function remoteDraftMerge({ localText, syncedText, dirty, remoteText }) {
  if (comparableDraftText(localText) === comparableDraftText(remoteText)) return "confirm";
  if (dirty) return localText === remoteText ? "confirm" : "preserve-local";
  return comparableDraftText(localText) === comparableDraftText(syncedText) ? "apply-remote" : "preserve-local";
}

export function createRemoteDraftSync({ prompt, status, fetchImpl, getTask, isSending }) {
  let revision = null;
  let syncedText = "";
  let dirty = false;
  let timer = null;
  let pending = null;
  let errorVisible = false;

  function reset() {
    clearTimeout(timer);
    timer = null;
    revision = null;
    syncedText = "";
    dirty = false;
    errorVisible = false;
  }

  function syncRemote(task, draft) {
    const remoteText = draft?.text || "";
    const remoteRevision = draft?.revision || null;
    const decision = remoteDraftMerge({ localText: prompt.value, syncedText, dirty, remoteText });
    if (decision === "confirm") {
      syncedText = prompt.value;
      revision = remoteRevision;
      dirty = false;
      if (errorVisible && !isSending()) status("", "");
      errorVisible = false;
    } else if (decision === "apply-remote") {
      prompt.value = remoteText;
      syncedText = remoteText;
      revision = remoteRevision;
      if (errorVisible && !remoteText && !isSending()) status("", "");
      errorVisible = false;
      if (remoteText && !isSending()) status(`已接入 ${task.device?.name || "所属设备"} 上尚未发送的草稿`, "accepted");
    }
  }

  function schedule(delay = 320) {
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void flush(); }, delay);
  }

  async function flush() {
    if (pending) return pending;
    const task = getTask();
    if (!task || !dirty || isSending()) return;
    const text = prompt.value;
    const expectedDraftRevision = revision;
    pending = (async () => {
      try {
        const url = `/api/tasks/${encodeURIComponent(task.id)}/draft?device=${encodeURIComponent(task.device.id)}`;
        const response = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, expectedDraftRevision }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || `HTTP ${response.status}`);
        if (getTask() !== task) return;
        syncedText = text;
        revision = result.draft?.revision || null;
        dirty = prompt.value !== text;
        errorVisible = false;
        if (!dirty && !isSending()) status(text ? `草稿已同步到 ${task.device?.name || "所属设备"}` : `已清除 ${task.device?.name || "所属设备"} 上的草稿`, "accepted");
      } catch (error) {
        if (getTask() === task) { errorVisible = true; status(`草稿未同步：${error.message}`, "error"); }
      } finally {
        pending = null;
        if (getTask() === task && dirty && prompt.value !== text) schedule(0);
      }
    })();
    return pending;
  }

  function markLocalChange() {
    dirty = prompt.value !== syncedText;
    if (dirty) schedule();
  }

  function cancelTimer() {
    clearTimeout(timer);
    timer = null;
  }

  return { reset, syncRemote, flush, markLocalChange, cancelTimer, get revision() { return revision; }, get dirty() { return dirty; } };
}
