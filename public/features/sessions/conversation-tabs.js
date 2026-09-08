export function conversationTabKey(task = {}) {
  const deviceId = typeof task.device?.id === "string" ? task.device.id : "";
  const taskId = typeof task.id === "string" ? task.id : "";
  return deviceId && taskId ? `${encodeURIComponent(deviceId)}/${encodeURIComponent(taskId)}` : "";
}

export class ConversationTabState {
  constructor() {
    this.tabs = [];
    this.activeKey = "home";
  }

  open(task) {
    const key = conversationTabKey(task);
    if (!key) return null;
    const existing = this.tabs.find((tab) => tab.key === key);
    if (existing) existing.task = task;
    else this.tabs.push({ key, task });
    this.activeKey = key;
    return task;
  }

  activate(key) {
    if (key === "home") {
      this.activeKey = "home";
      return null;
    }
    const tab = this.tabs.find((item) => item.key === key);
    if (!tab) return undefined;
    this.activeKey = key;
    return tab.task;
  }

  close(key) {
    const index = this.tabs.findIndex((tab) => tab.key === key);
    if (index < 0) return this.activeTask();
    const wasActive = this.activeKey === key;
    this.tabs.splice(index, 1);
    if (!wasActive) return this.activeTask();
    const next = this.tabs[index] || this.tabs[index - 1];
    this.activeKey = next?.key || "home";
    return next?.task || null;
  }

  activeTask() {
    return this.tabs.find((tab) => tab.key === this.activeKey)?.task || null;
  }
}

export function createConversationTabs({ element, onActivateTask, onActivateHome, documentRef = document }) {
  const home = documentRef.querySelector("[data-workspace-home]");
  const state = new ConversationTabState();

  function tabElement(item) {
    const tab = documentRef.createElement("div");
    tab.className = "workspace-tab workspace-conversation-tab";
    tab.dataset.conversationTabKey = item.key;
    tab.setAttribute("role", "tab");
    const selected = state.activeKey === item.key;
    tab.classList.toggle("is-active", selected);
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    tab.title = `${item.task.title || "未命名会话"}\n${item.task.device?.name || "所属设备"}`;
    const status = documentRef.createElement("span");
    status.className = "workspace-tab-status";
    status.dataset.status = item.task.status || "unknown";
    status.setAttribute("aria-hidden", "true");
    const title = documentRef.createElement("span");
    title.className = "workspace-tab-title";
    title.textContent = item.task.title || "未命名会话";
    const close = documentRef.createElement("button");
    close.className = "workspace-tab-close";
    close.type = "button";
    close.dataset.conversationTabClose = item.key;
    close.setAttribute("aria-label", `关闭会话标签：${item.task.title || "未命名会话"}`);
    close.textContent = "×";
    tab.append(status, title, close);
    return tab;
  }

  function render() {
    const homeActive = state.activeKey === "home";
    home.classList.toggle("is-active", homeActive);
    home.setAttribute("aria-selected", String(homeActive));
    home.tabIndex = homeActive ? 0 : -1;
    element.replaceChildren(...state.tabs.map(tabElement));
    const active = homeActive ? home : element.querySelector('[aria-selected="true"]');
    active?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }

  function activate(key, { focus = false } = {}) {
    const task = state.activate(key);
    if (task === undefined) return;
    render();
    if (task) onActivateTask(task);
    else onActivateHome();
    if (focus) (key === "home" ? home : [...element.querySelectorAll("[data-conversation-tab-key]")].find((tab) => tab.dataset.conversationTabKey === key))?.focus();
  }

  function close(key) {
    const previousKey = state.activeKey;
    const task = state.close(key);
    render();
    if (previousKey !== key) return;
    if (task) onActivateTask(task);
    else onActivateHome();
  }

  function bind() {
    home.addEventListener("click", () => activate("home"));
    element.addEventListener("click", (event) => {
      const closeButton = event.target.closest("[data-conversation-tab-close]");
      if (closeButton) return close(closeButton.dataset.conversationTabClose);
      const tab = event.target.closest("[data-conversation-tab-key]");
      if (tab) activate(tab.dataset.conversationTabKey);
    });
    documentRef.querySelector(".workspace-tabbar-inner").addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      const tabs = [home, ...element.querySelectorAll('[role="tab"]')];
      const index = tabs.indexOf(event.target.closest?.('[role="tab"]'));
      if (index < 0) return;
      event.preventDefault();
      let nextIndex = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : index + (event.key === "ArrowRight" ? 1 : -1);
      nextIndex = (nextIndex + tabs.length) % tabs.length;
      const next = tabs[nextIndex];
      activate(next === home ? "home" : next.dataset.conversationTabKey, { focus: true });
    });
  }

  function open(task) {
    if (!state.open(task)) return false;
    render();
    onActivateTask(task);
    return true;
  }

  render();
  return { bind, open, showHome: () => activate("home") };
}
