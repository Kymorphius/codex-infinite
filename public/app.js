import { installRestartButton } from "./features/runtime/index.js";
import { createDomServices } from "./core/dom.js";
import { formatDate, formatDuration, formatTokens, taskStatusLabel } from "./core/format.js";
import { createNavigation } from "./core/navigation.js";
import { createAdaptiveRefreshScheduler, taskRefreshDelay } from "./core/refresh-policy.js";
import { createAppState, MODULES } from "./core/state.js";
import { createTaskSource } from "./core/tasks.js";
import { createConsoleFeature } from "./features/console/index.js";
import { createContextFeature } from "./features/context/index.js";
import { createDispatchFeature } from "./features/dispatch/index.js";
import { createPriorityFeature } from "./features/priority/index.js";
import { createSessionsFeature } from "./features/sessions/index.js";
import { createZoteroFeature } from "./features/zotero/index.js";
import { createTurboFeature } from "./features/turbo/index.js";
import { createSkillsFeature } from "./features/skills/index.js";

(() => {
  const requestedModule = new URLSearchParams(location.search).get("module");
  const state = createAppState(requestedModule);
  const { $, setScopedState, showToast } = createDomServices();
  installRestartButton({ button: document.querySelector('[data-action="restart"]'), showToast });

  let sessionsFeature;
  let pendingRemoteReference = null;
  let pendingProjectCopyReference = null;
  const navigation = createNavigation({
    state, modules: MODULES, $, showToast,
    onActivate(module) {
      if (module === "zotero" && !state.zotero.initialized) void zoteroFeature.load();
      if (module === "context" && !state.context.initialized) void contextFeature.load();
      if (module === "skills") void skillsFeature.load();
    },
    async onRefresh() {
      const refreshes = [taskSource.load(), dispatchFeature.load()];
      if (state.module === "zotero") refreshes.push(zoteroFeature.load());
      if (state.module === "context") refreshes.push(contextFeature.load());
      await Promise.all(refreshes);
    },
    onOpenRemoteConversation(reference) {
      pendingRemoteReference = reference;
      if (sessionsFeature?.openRemoteReference(reference)) pendingRemoteReference = null;
    },
    onCopyRemoteProject(reference) {
      pendingProjectCopyReference = reference;
      if (sessionsFeature?.copyRemoteProjectReference(reference)) pendingProjectCopyReference = null;
    }
  });
  const requestOpen = (task) => navigation.requestOpen(task);

  const consoleFeature = createConsoleFeature({ state, $, formatDate, statusLabel: taskStatusLabel, requestOpen });
  const contextFeature = createContextFeature({ state, $, formatDate, formatTokens, showToast });
  const dispatchFeature = createDispatchFeature({ state, $, formatDate, showToast });
  const priorityFeature = createPriorityFeature({ state, $, formatDate, formatDuration });
  sessionsFeature = createSessionsFeature({ state, $, formatDate, statusLabel: taskStatusLabel, requestOpen });
  const zoteroFeature = createZoteroFeature({ state, $, setScopedState, showToast });
  const turboFeature = createTurboFeature({ $, showToast });
  const skillsFeature = createSkillsFeature({ $, showToast });

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
      if (pendingRemoteReference && sessionsFeature.openRemoteReference(pendingRemoteReference)) pendingRemoteReference = null;
      if (pendingProjectCopyReference && sessionsFeature.copyRemoteProjectReference(pendingProjectCopyReference)) pendingProjectCopyReference = null;
      priorityFeature.render();
      dispatchFeature.updateDestinations();
    }
  });

  contextFeature.bind();
  dispatchFeature.bind();
  sessionsFeature.bind();
  zoteroFeature.bind();
  turboFeature.bind();
  skillsFeature.bind();
  navigation.bind();
  navigation.updateChrome();
  Promise.all([taskSource.load(), dispatchFeature.load(), turboFeature.load()]);
  if (state.module === "zotero") void zoteroFeature.load();
  if (state.module === "context") void contextFeature.load();
  if (state.module === "skills") void skillsFeature.load();
  setInterval(() => void dispatchFeature.load({ quiet: true }), 2500);
  createAdaptiveRefreshScheduler({
    refresh: () => taskSource.load({ quiet: true }),
    nextDelay: () => taskRefreshDelay(state.tasks)
  }).start();
})();
