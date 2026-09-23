import { createExperimentsHttpHandler } from './experiments-http.mjs';
import { createSidebarHttpHandler } from './sidebar-http.mjs';
import { createRuntimeRestartHttpHandler } from "./runtime-restart-http.mjs";
import { createNativeAppLaunchHttpHandler } from "./native-app-launch-http.mjs";
import { createActivityHttpHandler } from "./activity-http.mjs";
import { createContextHttpHandler } from "./context-http.mjs";
import { createDispatchHttpHandler } from "./dispatch-http.mjs";
import { createGeneratorHttpHandler } from "./generator-http.mjs";
import { createHealthHttpHandler } from "./health-http.mjs";
import { createPeerActionHttpHandler } from "./peer-action-http.mjs";
import { createTasksHttpHandler } from "./tasks-http.mjs";
import { createZoteroHttpHandler } from "./zotero-http.mjs";
import { createTurboHttpHandler } from "./turbo-http.mjs";
import { createProjectCopyHttpHandler } from "./project-copy-http.mjs";
import { createDiagnosticsHttpHandler } from "./diagnostics-http.mjs";
import { createSkillsHttpHandler } from "./skills-http.mjs";
import { createJevRoutingHttpHandler } from "./jev-routing-http.mjs";
import { createPersonalPanelTaskHttpHandler } from './personal-panel-task-http.mjs';

export function createDashboardHandlers({ config, experimentService, adapter, local, remoteMessageService, remoteThreadSettingsService, turboCoordinator, turboPolicyService, skillSyncService, localSkillAdapter, projectCopyService, nodeRuntimeService, diagnosticsService, restartService, nativeAppLaunchService, zoteroAdapter, zoteroLocalApi, dispatchStore, checklistStore, generatorService, sidebarService, nativeSidebarAdapter, contextWindowStore, modelCatalog, jevRoutingService, personalPanelTaskAdapter }) {
  const health = createHealthHttpHandler(config);
  return [
    async (_request, response, requestUrl) => health(response, requestUrl),
    createRuntimeRestartHttpHandler({ service: restartService, dashboardOrigin: config.dashboardOrigin }),
    createNativeAppLaunchHttpHandler({ service: nativeAppLaunchService, dashboardOrigin: config.dashboardOrigin }),
    createSidebarHttpHandler({ sidebarService, nativeSidebarAdapter, dashboardOrigin: config.dashboardOrigin, nodeActionKeyPath: config.nodeActionKeyPath }),
    createExperimentsHttpHandler({ experimentService }),
    createDiagnosticsHttpHandler({ diagnosticsService }),
    createSkillsHttpHandler({ skillSyncService, localSkillAdapter, dashboardOrigin: config.dashboardOrigin, nodeActionKeyPath: config.nodeActionKeyPath }),
    createPeerActionHttpHandler({ adapter, remoteMessageService, remoteThreadSettingsService, dashboardOrigin: config.dashboardOrigin, nodeActionKeyPath: config.nodeActionKeyPath }),
    createTurboHttpHandler({ turboCoordinator, turboPolicyService, jevRoutingService, dashboardOrigin: config.dashboardOrigin, nodeActionKeyPath: config.nodeActionKeyPath }),
    createJevRoutingHttpHandler({ service: jevRoutingService, dashboardOrigin: config.dashboardOrigin }),
    createPersonalPanelTaskHttpHandler({ adapter: personalPanelTaskAdapter, localAdapter: local, localDevice: config.nodeDevice, dashboardOrigin: config.dashboardOrigin }),
    createProjectCopyHttpHandler({ service: projectCopyService, dashboardOrigin: config.dashboardOrigin }),
    createActivityHttpHandler({ adapter, localAdapter: local, remoteMessageService, remoteThreadSettingsService }),
    createZoteroHttpHandler({ zoteroAdapter, zoteroLocalApi, dashboardOrigin: config.dashboardOrigin }),
    createTasksHttpHandler({ adapter, localAdapter: local, nodeRuntimeService }),
    createContextHttpHandler({ adapter: local, contextWindowStore, modelCatalog, dashboardOrigin: config.dashboardOrigin }),
    createGeneratorHttpHandler({ adapter: local, generatorService, dashboardOrigin: config.dashboardOrigin }),
    createDispatchHttpHandler({ adapter: local, dispatchStore, checklistStore, dashboardOrigin: config.dashboardOrigin })
  ];
}
