export function createNavigation({ state, modules, $, showToast, onActivate, onRefresh, onOpenRemoteConversation = () => {}, onCopyRemoteProject = () => {}, documentRef = document, windowRef = window }) {
  function updateChrome() {
    const module = modules[state.module];
    let selectedTab = null;
    $('[data-testid="module-title"]').textContent = module.title;
    $('[data-testid="module-caption"]').textContent = module.caption;
    documentRef.title = `${module.title} · Codex`;
    for (const tab of documentRef.querySelectorAll("[data-module-target]")) {
      const selected = tab.dataset.moduleTarget === state.module;
      tab.classList.toggle("is-active", selected);
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected) selectedTab = tab;
    }
    for (const panel of documentRef.querySelectorAll("[data-module-panel]")) {
      panel.classList.toggle("hidden", panel.dataset.modulePanel !== state.module);
    }
    selectedTab?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }

  function showModule(module, announce = false) {
    state.module = Object.hasOwn(modules, module) ? module : "board";
    updateChrome();
    if (announce) showToast(`${modules[state.module].title}已打开`);
    onActivate(state.module);
  }

  function requestOpen(task) {
    if (windowRef.parent === windowRef) return showToast("请在 Codex 控制台中打开任务。");
    windowRef.parent.postMessage({ type: "codex-control-console-open-task", task: { id: task.id, title: task.title, device: task.device || null } }, "*");
    showToast("正在请求 Codex 打开任务…");
  }

  function bind() {
    documentRef.addEventListener("click", async (event) => {
      const element = event.target.closest("[data-action]");
      const action = element?.dataset.action;
      if (action === "refresh") await onRefresh();
      if (action === "module") showModule(element.dataset.moduleTarget, true);
      if (action === "close" && windowRef.parent !== windowRef) windowRef.parent.postMessage({ type: "codex-control-console-close" }, "*");
    });
    documentRef.addEventListener("keydown", (event) => {
      const current = event.target.closest?.('[role="tab"][data-module-target]');
      if (!current || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      const tabs = [...documentRef.querySelectorAll('[role="tab"][data-module-target]')];
      const currentIndex = tabs.indexOf(current);
      if (currentIndex < 0 || !tabs.length) return;
      event.preventDefault();
      let nextIndex = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : currentIndex + (event.key === "ArrowRight" ? 1 : -1);
      nextIndex = (nextIndex + tabs.length) % tabs.length;
      const next = tabs[nextIndex];
      showModule(next.dataset.moduleTarget);
      next.focus();
    });
    windowRef.addEventListener("message", (event) => {
      if (event.source === windowRef.parent && event.data?.type === "codex-control-console-open-remote-conversation") {
        showModule("sessions");
        onOpenRemoteConversation(event.data.reference || {});
        return;
      }
      if (event.source === windowRef.parent && event.data?.type === "codex-control-console-copy-remote-project") {
        showModule("sessions");
        onCopyRemoteProject(event.data.reference || {});
        return;
      }
      if (event.data?.type === "codex-control-console-show-module") return showModule(event.data.module, true);
      if (event.data?.type !== "codex-control-console-open-task-result") return;
      const result = event.data.result || {};
      showToast(result.ok ? `已请求打开：${result.title || "任务"}` : result.message || "该任务暂不支持直接打开。");
    });
  }

  return { bind, requestOpen, showModule, updateChrome };
}
