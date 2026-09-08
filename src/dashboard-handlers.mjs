import { createRuntimeRestartHttpHandler } from "./runtime-restart-http.mjs";
import { createActivityHttpHandler } from "./activity-http.mjs";
import { createContextHttpHandler } from "./context-http.mjs";
import { createDispatchHttpHandler } from "./dispatch-http.mjs";
import { createHealthHttpHandler } from "./health-http.mjs";
import { createPeerActionHttpHandler } from "./peer-action-http.mjs";
import { createTasksHttpHandler } from "./tasks-http.mjs";
import { createZoteroHttpHandler } from "./zotero-http.mjs";
import { createTurboHttpHandler } from "./turbo-http.mjs";
import { createProjectCopyHttpHandler } from "./project-copy-http.mjs";
import { createDiagnosticsHttpHandler } from "./diagnostics-http.mjs";
import { createSkillsHttpHandler } from "./skills-http.mjs";

export function createDashboardHandlers({ config, adapter, local, remoteMessageService, remoteThreadSettingsService, turboCoordinator, turboPolicyService, skillSyncService, localSkillAdapter, projectCopyService, nodeRuntimeService, diagnosticsService, restartService, zoteroAdapter, zoteroLocalApi, dispatchStore, contextWindowStore, modelCatalog }) {
  const health = createHealthHttpHandler(config);
  return [
    async (_request, response, requestUrl) => health(response, requestUrl),
    createRuntimeRestartHttpHandler({ service: restartService, dashboardOrigin: config.dashboardOrigin }),
    createDiagnosticsHttpHandler({ diagnosticsService }),
    createSkillsHttpHandler({ skillSyncService, localSkillAdapter, dashboardOrigin: config.dashboardOrigin, nodeActionKeyPath: config.nodeActionKeyPath }),
    createPeerActionHttpHandler({ adapter, remoteMessageService, remoteThreadSettingsService, dashboardOrigin: config.dashboardOrigin, nodeActionKeyPath: config.nodeActionKeyPath }),
    createTurboHttpHandler({ turboCoordinator, turboPolicyService, dashboardOrigin: config.dashboardOrigin, nodeActionKeyPath: config.nodeActionKeyPath }),
    createProjectCopyHttpHandler({ service: projectCopyService, dashboardOrigin: config.dashboardOrigin }),
    createActivityHttpHandler({ adapter, localAdapter: local, remoteMessageService, remoteThreadSettingsService }),
    createZoteroHttpHandler({ zoteroAdapter, zoteroLocalApi, dashboardOrigin: config.dashboardOrigin }),
    createTasksHttpHandler({ adapter, localAdapter: local, nodeRuntimeService }),
    createContextHttpHandler({ adapter: local, contextWindowStore, modelCatalog, dashboardOrigin: config.dashboardOrigin }),
    createDispatchHttpHandler({ adapter: local, dispatchStore, dashboardOrigin: config.dashboardOrigin })
  ];
}
