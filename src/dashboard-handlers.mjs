import { createActivityHttpHandler } from "./activity-http.mjs";
import { createContextHttpHandler } from "./context-http.mjs";
import { createDispatchHttpHandler } from "./dispatch-http.mjs";
import { createHealthHttpHandler } from "./health-http.mjs";
import { createPeerActionHttpHandler } from "./peer-action-http.mjs";
import { createTasksHttpHandler } from "./tasks-http.mjs";
import { createZoteroHttpHandler } from "./zotero-http.mjs";

export function createDashboardHandlers({ config, adapter, local, remoteMessageService, zoteroAdapter, zoteroLocalApi, dispatchStore, contextWindowStore, modelCatalog }) {
  const health = createHealthHttpHandler(config);
  return [
    async (_request, response, requestUrl) => health(response, requestUrl),
    createPeerActionHttpHandler({ adapter, remoteMessageService, dashboardOrigin: config.dashboardOrigin, nodeActionKeyPath: config.nodeActionKeyPath }),
    createActivityHttpHandler({ adapter, localAdapter: local, remoteMessageService }),
    createZoteroHttpHandler({ zoteroAdapter, zoteroLocalApi, dashboardOrigin: config.dashboardOrigin }),
    createTasksHttpHandler({ adapter, localAdapter: local }),
    createContextHttpHandler({ adapter: local, contextWindowStore, modelCatalog, dashboardOrigin: config.dashboardOrigin }),
    createDispatchHttpHandler({ adapter: local, dispatchStore, dashboardOrigin: config.dashboardOrigin })
  ];
}
