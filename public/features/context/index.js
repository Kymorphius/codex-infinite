import { requestJson } from "../../core/transport.js";
import { isLocalTask } from "../../core/tasks.js";

export function contextMetrics(items = [], available = true) {
  return {
    count: available ? String(items.length) : "—",
    millionCount: available ? String(items.filter((item) => item.requestedContextWindow >= 1_000_000).length) : "—"
  };
}

export function createContextFeature({ state, $, formatDate, formatTokens, showToast }) {
  const panel = $('[data-module-panel="context"]');
  const form = $('[data-testid="context-form"]');
  const list = $('[data-testid="context-list"]');
  const threadOptions = $('[data-testid="context-thread-options"]');

  function renderThreadOptions() {
    threadOptions.replaceChildren(...state.tasks.filter(isLocalTask).map((task) => {
      const option = document.createElement("option");
      option.value = task.id;
      option.label = `${task.project || "未归类"} · ${task.title}`;
      return option;
    }));
  }

  function contextCard(item) {
    const card = document.createElement("article");
    card.className = "context-card";
    card.dataset.threadId = item.threadId;
    const heading = document.createElement("div");
    heading.className = "context-card-heading";
    const titleGroup = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = item.threadTitle;
    const id = document.createElement("code");
    id.textContent = item.threadId;
    titleGroup.append(title, id);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "quiet-button";
    remove.textContent = "移除覆盖";
    remove.dataset.contextAction = "remove";
    remove.dataset.threadId = item.threadId;
    heading.append(titleGroup, remove);

    const values = document.createElement("div");
    values.className = "context-values";
    const rows = [
      ["请求值", formatTokens(item.requestedContextWindow)],
      [item.clamped ? "模型接受值（已钳制）" : "模型接受值", formatTokens(item.acceptedContextWindow)],
      [`预计有效值（${item.effectiveContextWindowPercent}%）`, formatTokens(item.estimatedEffectiveContextWindow)],
      ["最近观测值", formatTokens(item.observedContextWindow)]
    ];
    for (const [label, value] of rows) {
      const metric = document.createElement("div");
      const name = document.createElement("span");
      name.textContent = label;
      const strong = document.createElement("strong");
      strong.textContent = value;
      metric.append(name, strong);
      values.append(metric);
    }
    const footer = document.createElement("p");
    footer.className = "context-card-footer";
    footer.textContent = `${item.project || "项目未知"} · ${item.model || "模型未知"} · 保存于 ${formatDate(item.updatedAt)}${item.taskAvailable ? "" : " · 会话记录当前不可读"}`;
    card.append(heading, values, footer);
    return card;
  }

  function setState(status, message = "") {
    state.context.status = status;
    for (const element of panel.querySelectorAll("[data-context-state]")) element.classList.toggle("hidden", element.dataset.contextState !== status);
    const messageElement = panel.querySelector("[data-context-state-message]");
    if (message && messageElement) messageElement.textContent = message;
    const metrics = contextMetrics(state.context.items, status === "connected" || status === "empty");
    $('[data-testid="context-count"]').textContent = metrics.count;
    $('[data-testid="context-million-count"]').textContent = metrics.millionCount;
    $('[data-testid="context-status"]').textContent = { loading: "读取中", connected: "已启用", empty: "未配置", error: "异常" }[status] || "未知";
  }

  async function load({ quiet = false } = {}) {
    state.context.initialized = true;
    if (!quiet) setState("loading");
    try {
      const data = await requestJson("/api/context-overrides", { cache: "no-store" });
      state.context.items = Array.isArray(data.items) ? data.items : [];
      list.replaceChildren(...state.context.items.map(contextCard));
      setState(state.context.items.length ? "connected" : "empty");
    } catch (error) {
      setState("error", error.message);
    }
  }

  async function submit(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const threadId = String(data.threadId || "").trim();
    try {
      const result = await requestJson(`/api/context-overrides/${encodeURIComponent(threadId)}`, {
        method: "PUT", body: { contextWindow: Number(data.contextWindow) }
      });
      await load({ quiet: true });
      showToast(result.item.clamped
        ? `已保存；模型会将请求钳制为 ${formatTokens(result.item.acceptedContextWindow)} tokens。`
        : `已为该会话保存 ${formatTokens(result.item.requestedContextWindow)} tokens。`);
    } catch (error) {
      showToast(error.message);
    }
  }

  async function handleClick(event) {
    const button = event.target.closest("[data-context-action]");
    if (button) {
      button.disabled = true;
      try {
        await requestJson(`/api/context-overrides/${encodeURIComponent(button.dataset.threadId)}`, { method: "DELETE" });
        await load({ quiet: true });
        showToast("已移除该会话的上下文覆盖。");
      } catch (error) {
        showToast(error.message);
        button.disabled = false;
      }
      return;
    }
    if (event.target.closest('[data-action="refresh-context"]')) await load();
  }

  function bind() {
    form.addEventListener("submit", submit);
    panel.addEventListener("click", handleClick);
  }

  return { bind, load, renderThreadOptions };
}
