import { conversationEntryKey, conversationEntrySignature, conversationTurnPresentation, presentConversationEntries, shouldFollowConversationLatest } from "./conversation-model.js";
import { renderExecutionEntry } from "./execution-view.js";
import { acceptedMessageLabel, conversationOwnerLabel } from "./model.js";
import { createRemoteApprovals } from "./remote-approvals.js";
import { createSessionSettingsController } from "./settings-controller.js";
import { createAdaptiveRefreshScheduler, OPEN_CONVERSATION_REFRESH_MS } from "../../core/refresh-policy.js";

export function createRemoteConversation({ $, formatDate, fetchImpl = fetch }) {
  const layer = $('[data-testid="session-activity-layer"]');
  const list = $('[data-testid="session-activity-list"]');
  const state = $('[data-testid="session-activity-state"]');
  const stateMessage = $('[data-testid="session-activity-state-message"]');
  const retry = $('[data-testid="session-activity-retry"]');
  const composer = $('[data-testid="session-remote-composer"]');
  const prompt = $('[data-testid="session-remote-prompt"]');
  const send = $('[data-testid="session-remote-send"]');
  const settings = $('[data-testid="session-remote-settings"]');
  const sendStatus = $('[data-testid="session-remote-send-status"]');
  const stop = $('[data-testid="session-remote-stop"]');
  const turnState = $('[data-testid="session-activity-turn-state"]');
  const approvalList = $('[data-testid="session-approval-list"]');
  let selectedTask = null;
  let loading = false;
  let sending = false;
  let stopping = false;
  let activeTurnId = null;
  let draftRevision = null;
  let syncedDraftText = "";
  const refreshScheduler = createAdaptiveRefreshScheduler({
    refresh: () => selectedTask ? load({ quiet: true }) : Promise.resolve(),
    nextDelay: () => OPEN_CONVERSATION_REFRESH_MS
  });
  const approvals = createRemoteApprovals({
    element: approvalList,
    fetchImpl,
    onStatus(message, status) {
      sendStatus.dataset.status = status;
      sendStatus.textContent = message;
    },
    onResolved() { setTimeout(() => void load({ quiet: true }), 350); }
  });
  const settingsController = createSessionSettingsController({
    element: settings,
    fetchImpl,
    onStatus(message, status) {
      sendStatus.dataset.status = status;
      sendStatus.textContent = message;
    }
  });

  function renderEntry(entry, index) {
    if (entry.kind === "tool") return renderExecutionEntry(entry, index, { formatDate });
    const item = document.createElement("article");
    item.className = "conversation-entry";
    item.dataset.kind = entry.kind;
    item.dataset.role = entry.role;
    item.dataset.entryKey = conversationEntryKey(entry, index);
    item.dataset.entrySignature = conversationEntrySignature(entry);
    const body = document.createElement("div");
    body.className = "conversation-entry-body";
    const label = document.createElement("span");
    label.className = "conversation-entry-label";
    label.textContent = entry.label;
    const text = document.createElement("p");
    text.textContent = entry.text;
    body.append(label, text);
    if (entry.timestamp) {
      const time = document.createElement("time");
      time.textContent = formatDate(entry.timestamp);
      body.append(time);
    }
    if (entry.role === "assistant") {
      const mark = document.createElement("span");
      mark.className = "conversation-codex-mark";
      mark.textContent = "✣";
      mark.setAttribute("aria-hidden", "true");
      item.append(mark, body);
    } else {
      item.append(body);
    }
    return item;
  }

  function reconcileEntries(entries) {
    let cursor = list.firstElementChild;
    entries.forEach((entry, index) => {
      const key = conversationEntryKey(entry, index);
      const signature = conversationEntrySignature(entry);
      if (cursor?.dataset.entryKey !== key) {
        const match = Array.from(list.children).find((node) => node.dataset.entryKey === key);
        if (match) list.insertBefore(match, cursor);
        else list.insertBefore(renderEntry(entry, index), cursor);
      }
      const node = cursor?.dataset.entryKey === key ? cursor : list.children[index];
      if (node?.dataset.entrySignature !== signature) {
        const executionOpen = node?.querySelector?.(".execution-card")?.open === true;
        const replacement = renderEntry(entry, index);
        const replacementDisclosure = replacement.querySelector?.(".execution-card");
        if (executionOpen && replacementDisclosure) replacementDisclosure.open = true;
        node?.replaceWith(replacement);
      }
      cursor = list.children[index]?.nextElementSibling || null;
    });
    while (list.children.length > entries.length) list.lastElementChild.remove();
  }

  function renderTurnState(activity, task) {
    const value = activity?.turnState || (task.status === "active" ? "active" : task.status === "interrupted" ? "interrupted" : "unknown");
    const presentation = conversationTurnPresentation(value);
    turnState.dataset.state = presentation.tone;
    turnState.textContent = presentation.label;
    activeTurnId = value === "active" ? activity?.turnId || null : null;
    stop.classList.toggle("hidden", !activeTurnId);
    stop.disabled = stopping;
  }

  function syncDraft(task, draft) {
    if (draft?.text && draft.revision && (!prompt.value.trim() || prompt.value === syncedDraftText)) {
      prompt.value = draft.text;
      syncedDraftText = draft.text;
      draftRevision = draft.revision;
      if (!sending) {
        sendStatus.dataset.status = "accepted";
        sendStatus.textContent = `已接入 ${task.device?.name || "所属设备"} 上尚未发送的草稿`;
      }
    } else if (!draft && prompt.value === syncedDraftText) {
      prompt.value = "";
      syncedDraftText = "";
      draftRevision = null;
    }
  }

  async function load({ quiet = false } = {}) {
    if (!selectedTask || loading) return;
    loading = true;
    const task = selectedTask;
    if (!quiet) {
      stateMessage.textContent = "正在打开会话…";
      retry.classList.add("hidden");
      state.classList.remove("hidden");
      list.classList.add("hidden");
    }
    try {
      const url = `/api/tasks/${encodeURIComponent(task.id)}/activity?device=${encodeURIComponent(task.device.id)}`;
      const response = await fetchImpl(url, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || `HTTP ${response.status}`);
      if (selectedTask !== task) return;
      const entries = Array.isArray(result.activity?.entries) ? result.activity.entries : [];
      syncDraft(task, result.activity?.draft);
      const presentedEntries = presentConversationEntries(entries);
      const previousScrollTop = list.scrollTop;
      const followLatest = shouldFollowConversationLatest({ quiet, scrollHeight: list.scrollHeight, scrollTop: previousScrollTop, clientHeight: list.clientHeight });
      reconcileEntries(presentedEntries);
      renderTurnState(result.activity, task);
      settingsController.render(task, result.activity);
      approvals.render(result.activity?.approvals || [], task);
      if (result.activity?.title) $('[data-testid="session-activity-title"]').textContent = result.activity.title;
      list.classList.toggle("hidden", presentedEntries.length === 0);
      state.classList.toggle("hidden", presentedEntries.length > 0);
      stateMessage.textContent = presentedEntries.length ? "" : "这个会话还没有可显示的消息";
      retry.classList.add("hidden");
      $('[data-testid="session-activity-updated"]').textContent = `更新于 ${formatDate(result.activity?.updatedAt || new Date().toISOString())}`;
      list.scrollTo({ top: followLatest ? list.scrollHeight : previousScrollTop, behavior: "instant" });
    } catch (error) {
      if (selectedTask !== task) return;
      stateMessage.textContent = `暂时无法打开这个会话：${error.message}`;
      retry.classList.remove("hidden");
      state.classList.remove("hidden");
      if (!quiet) list.classList.add("hidden");
    } finally {
      loading = false;
    }
  }

  function open(task) {
    selectedTask = task;
    $('[data-testid="session-activity-title"]').textContent = task.title;
    $('[data-testid="session-activity-directory"]').textContent = task.cwd || "未记录工作目录";
    $('[data-testid="session-activity-owner"]').textContent = conversationOwnerLabel(task);
    prompt.placeholder = `发送消息到 ${task.device?.name || "远端设备"}`;
    prompt.value = "";
    syncedDraftText = "";
    draftRevision = null;
    activeTurnId = null;
    renderTurnState({ turnState: task.status === "active" ? "active" : "unknown", turnId: null }, task);
    settingsController.render(task);
    sendStatus.textContent = "";
    approvals.reset();
    layer.classList.remove("hidden");
    void load();
  }

  function close() {
    selectedTask = null;
    approvals.reset();
    settingsController.reset();
    layer.classList.add("hidden");
  }

  async function submit() {
    const task = selectedTask;
    const message = prompt.value.trim();
    if (!task || !message || sending) return;
    sending = true;
    send.disabled = true;
    prompt.disabled = true;
    sendStatus.dataset.status = "sending";
    sendStatus.textContent = `正在发送到 ${task.device?.name || "远端设备"}…`;
    try {
      const url = `/api/tasks/${encodeURIComponent(task.id)}/messages?device=${encodeURIComponent(task.device.id)}`;
      const response = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: message, expectedDraftRevision: draftRevision }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || `HTTP ${response.status}`);
      if (selectedTask !== task) return;
      prompt.value = "";
      syncedDraftText = "";
      draftRevision = null;
      sendStatus.dataset.status = "accepted";
      sendStatus.textContent = acceptedMessageLabel(task, result);
      setTimeout(() => void load({ quiet: true }), 1000);
    } catch (error) {
      if (selectedTask !== task) return;
      sendStatus.dataset.status = "error";
      sendStatus.textContent = `发送失败：${error.message}`;
      await load({ quiet: true });
    } finally {
      sending = false;
      send.disabled = false;
      prompt.disabled = false;
      prompt.focus();
    }
  }

  async function interrupt() {
    const task = selectedTask;
    const turnId = activeTurnId;
    if (!task || !turnId || stopping) return;
    stopping = true;
    stop.disabled = true;
    sendStatus.dataset.status = "sending";
    sendStatus.textContent = `正在停止 ${task.device?.name || "远端设备"} 上的这一轮…`;
    try {
      const url = `/api/tasks/${encodeURIComponent(task.id)}/control?device=${encodeURIComponent(task.device.id)}`;
      const response = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "interrupt", turnId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || `HTTP ${response.status}`);
      if (selectedTask !== task) return;
      sendStatus.dataset.status = "accepted";
      sendStatus.textContent = `${task.device?.name || "远端设备"} 已接收停止请求`;
      setTimeout(() => void load({ quiet: true }), 350);
    } catch (error) {
      if (selectedTask !== task) return;
      sendStatus.dataset.status = "error";
      sendStatus.textContent = `停止失败：${error.message}`;
      await load({ quiet: true });
    } finally {
      stopping = false;
      stop.disabled = false;
    }
  }

  function bind() {
    settingsController.bind();
    for (const button of layer.querySelectorAll("[data-session-activity-close]")) {
      button.addEventListener("pointerdown", (event) => { if (event.button === 0) close(); });
      button.addEventListener("click", close);
    }
    document.addEventListener("keydown", (event) => { if (event.key === "Escape" && selectedTask) close(); });
    composer.addEventListener("submit", (event) => { event.preventDefault(); void submit(); });
    stop.addEventListener("click", () => void interrupt());
    retry.addEventListener("click", () => void load());
    prompt.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); composer.requestSubmit(); }
    });
    refreshScheduler.start();
  }

  return { bind, open };
}
