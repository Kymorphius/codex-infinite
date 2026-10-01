import { createExperimentsFeature } from './features/experiments/index.js';
import { installRestartButton } from "./features/runtime/index.js";
import { installRouterStatus } from "./features/runtime/router-status.js";
import { createDomServices } from "./core/dom.js";
import { formatDate, formatDuration, formatTokens, taskStatusLabel } from "./core/format.js";
import { announceEmbeddedReady, createNavigation } from "./core/navigation.js";
import { createAdaptiveRefreshScheduler, taskRefreshDelay } from "./core/refresh-policy.js";
import { createAppState, initialAppModule, MODULES } from "./core/state.js";
import { createTaskSource } from "./core/tasks.js";
import { createConsoleFeature } from "./features/console/index.js";
import { createContextFeature } from "./features/context/index.js";
import { createUsageFeature } from "./features/usage/index.js";
import { createDispatchFeature } from "./features/dispatch/index.js";
import { createGeneratorsFeature } from "./features/generators/index.js";
import { createPriorityFeature } from "./features/priority/index.js";
import { createSessionsFeature } from "./features/sessions/index.js";
import { createZoteroFeature } from "./features/zotero/index.js";
import { createTurboFeature } from "./features/turbo/index.js";
import { createSkillsFeature } from "./features/skills/index.js";
import { createJevRoutingFeature } from "./features/jev-routing/index.js";
import { createTerminalFeature } from "./features/terminal/index.js";

(() => {
  announceEmbeddedReady();
  const requestedModule = initialAppModule(location.search);
  const state = createAppState(requestedModule);
  const { $, setScopedState, showToast } = createDomServices();
  installRestartButton({ button: document.querySelector('[data-action="restart"]'), showToast });
  installRouterStatus({ pill: document.querySelector('[data-router-status]'), showToast });

  let sessionsFeature;
  let pendingRemoteReference = null;
  let pendingProjectCopyReference = null;
  const navigation = createNavigation({
    state, modules: MODULES, $, showToast,
    onActivate(module) {
      if (module === "terminal") void terminalFeature.load();
      else terminalFeature.deactivate();
      if (module === "zotero" && !state.zotero.initialized) void zoteroFeature.load();
      if (module === "context" && !state.context.initialized) void contextFeature.load();
      if (module === "experiments") void experimentsFeature.load();
      if (module === "skills") void skillsFeature.load();
      if (module === "generators") void generatorsFeature.load();
      if (module === "jev-routing") void jevRoutingFeature.load();
      if (module === "usage") void usageFeature.load();
    },
    async onRefresh() {
      if (state.module === "terminal") return terminalFeature.load();
      if (state.module === "experiments") return experimentsFeature.load();
      const refreshes = [taskSource.load(), dispatchFeature.load(), generatorsFeature.load()];
      if (state.module === "zotero") refreshes.push(zoteroFeature.load());
      if (state.module === "context") refreshes.push(contextFeature.load());
      if (state.module === "usage") refreshes.push(usageFeature.load());
      await Promise.all(refreshes);
    },
    onOpenRemoteConversation(reference) {
      pendingRemoteReference = reference;
      if (sessionsFeature?.openRemoteReference(reference)) pendingRemoteReference = null;
    },
    onCopyRemoteProject(reference) {
      pendingProjectCopyReference = reference;
      if (sessionsFeature?.copyRemoteProjectReference(reference)) pendingProjectCopyReference = null;
    },
    onOpenTerminalConversation(reference) {
      terminalFeature.openReference(reference);
    }
  });
  const requestOpen = (task) => navigation.requestOpen(task);

  const consoleFeature = createConsoleFeature({ state, $, formatDate, statusLabel: taskStatusLabel, requestOpen });
  const contextFeature = createContextFeature({ state, $, formatDate, formatTokens, showToast });
  const usageFeature = createUsageFeature({ $, formatDate });
  const dispatchFeature = createDispatchFeature({ state, $, formatDate, showToast, requestOpen });
  const generatorsFeature = createGeneratorsFeature({ state, $, formatDate, showToast });
  const priorityFeature = createPriorityFeature({ state, $, formatDate, formatDuration });
  sessionsFeature = createSessionsFeature({ state, $, formatDate, statusLabel: taskStatusLabel, requestOpen,
    onOpenTerminalReference(reference) { terminalFeature.openReference(reference); navigation.showModule('terminal'); } });
  const zoteroFeature = createZoteroFeature({ state, $, setScopedState, showToast });
  const turboFeature = createTurboFeature({ $, showToast });
  const experimentsFeature = createExperimentsFeature({ $ });
  const skillsFeature = createSkillsFeature({ $, showToast });
  const jevRoutingFeature = createJevRoutingFeature({ $, showToast });
  const terminalFeature = createTerminalFeature({ state, $, showToast });

  const taskSource = createTaskSource({
    state,
    onState({ status, label, source, message }) {
      state.taskStatus = status;
      consoleFeature.setTaskState(status, label, message);
      sessionsFeature.setTaskState(status, label);
      priorityFeature.setTaskState(status, label, source, message);
      dispatchFeature.setTaskState(status, label);
      generatorsFeature.setTaskState(status);
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
      generatorsFeature.updateDestinations();
    }
  });

  contextFeature.bind();
  usageFeature.bind();
  dispatchFeature.bind();
  generatorsFeature.bind();
  sessionsFeature.bind();
  zoteroFeature.bind();
  turboFeature.bind();
  experimentsFeature.bind();
  skillsFeature.bind();
  jevRoutingFeature.bind();
  terminalFeature.bind();
  window.addEventListener("pagehide", event => { if (!event.persisted) terminalFeature.dispose(); });
  navigation.bind();
  navigation.updateChrome();
  Promise.all([taskSource.load(), dispatchFeature.load(), generatorsFeature.load(), turboFeature.load()]);
  if (state.module === "zotero") void zoteroFeature.load();
  if (state.module === "context") void contextFeature.load();
  if (state.module === "usage") void usageFeature.load();
  if (state.module === "experiments") void experimentsFeature.load();
  if (state.module === "skills") void skillsFeature.load();
  if (state.module === "jev-routing") void jevRoutingFeature.load();
  if (state.module === "terminal") void terminalFeature.load();
  setInterval(() => void dispatchFeature.load({ quiet: true }), 2500);
  setInterval(() => void generatorsFeature.load({ quiet: true }), 2500);
  createAdaptiveRefreshScheduler({
    refresh: () => taskSource.load({ quiet: true }),
    nextDelay: () => taskRefreshDelay(state.tasks)
  }).start();
})();
