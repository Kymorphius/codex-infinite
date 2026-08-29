import { createDomServices } from "./core/dom.js";
import { formatDate, formatDuration, formatTokens, taskStatusLabel } from "./core/format.js";
import { createNavigation } from "./core/navigation.js";
import { createAppState, MODULES } from "./core/state.js";
import { createTaskSource } from "./core/tasks.js";
import { createConsoleFeature } from "./features/console/index.js";
import { createContextFeature } from "./features/context/index.js";
import { createDispatchFeature } from "./features/dispatch/index.js";
import { createPriorityFeature } from "./features/priority/index.js";
import { createSessionsFeature } from "./features/sessions/index.js";
import { createZoteroFeature } from "./features/zotero/index.js";

(() => {
  const requestedModule = new URLSearchParams(location.search).get("module");
  const state = createAppState(requestedModule);
  const { $, setScopedState, showToast } = createDomServices();

  const navigation = createNavigation({
    state, modules: MODULES, $, showToast,
    onActivate(module) {
      if (module === "zotero" && !state.zotero.initialized) void zoteroFeature.load();
      if (module === "context" && !state.context.initialized) void contextFeature.load();
    },
    async onRefresh() {
      const refreshes = [taskSource.load(), dispatchFeature.load()];
      if (state.module === "zotero") refreshes.push(zoteroFeature.load());
      if (state.module === "context") refreshes.push(contextFeature.load());
      await Promise.all(refreshes);
    }
  });
  const requestOpen = (task) => navigation.requestOpen(task);

  const consoleFeature = createConsoleFeature({ state, $, formatDate, statusLabel: taskStatusLabel, requestOpen });
  const contextFeature = createContextFeature({ state, $, formatDate, formatTokens, showToast });
  const dispatchFeature = createDispatchFeature({ state, $, formatDate, showToast });
  const priorityFeature = createPriorityFeature({ state, $, formatDate, formatDuration });
  const sessionsFeature = createSessionsFeature({ state, $, formatDate, statusLabel: taskStatusLabel, requestOpen });
  const zoteroFeature = createZoteroFeature({ state, $, setScopedState, showToast });

  const taskSource = createTaskSource({
    state,
    onState({ status, label, source, message }) {
      state.taskStatus = status;
      consoleFeature.setTaskState(status, label, message);
      sessionsFeature.setTaskState(status, label);
      priorityFeature.setTaskState(status, label, source, message);
      dispatchFeature.setTaskState(status, label);
    },
    onData({ status }) {
      contextFeature.renderThreadOptions();
      if (status !== "connected") return;
      consoleFeature.render();
      sessionsFeature.render();
      priorityFeature.render();
      dispatchFeature.updateDestinations();
    }
  });

  contextFeature.bind();
  dispatchFeature.bind();
  sessionsFeature.bind();
  zoteroFeature.bind();
  navigation.bind();
  navigation.updateChrome();
  Promise.all([taskSource.load(), dispatchFeature.load()]);
  if (state.module === "zotero") void zoteroFeature.load();
  if (state.module === "context") void contextFeature.load();
  setInterval(() => void dispatchFeature.load({ quiet: true }), 2500);
})();
