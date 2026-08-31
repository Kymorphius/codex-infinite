export function createNavigation({ state, modules, $, showToast, onActivate, onRefresh, documentRef = document, windowRef = window }) {
  function updateChrome() {
    const module = modules[state.module];
    $('[data-testid="module-title"]').textContent = module.title;
    $('[data-testid="module-caption"]').textContent = module.caption;
    documentRef.title = `${module.title} · Codex`;
    for (const tab of documentRef.querySelectorAll("[data-module-target]")) {
      const selected = tab.dataset.moduleTarget === state.module;
      tab.classList.toggle("is-active", selected);
      if (selected) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
    }
    for (const panel of documentRef.querySelectorAll("[data-module-panel]")) {
      panel.classList.toggle("hidden", panel.dataset.modulePanel !== state.module);
    }
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
    windowRef.addEventListener("message", (event) => {
      if (event.data?.type === "codex-control-console-show-module") return showModule(event.data.module, true);
      if (event.data?.type !== "codex-control-console-open-task-result") return;
      const result = event.data.result || {};
      showToast(result.ok ? `已请求打开：${result.title || "任务"}` : result.message || "该任务暂不支持直接打开。");
    });
  }

  return { bind, requestOpen, showModule, updateChrome };
}
