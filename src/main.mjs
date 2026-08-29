import { getConfig } from "./config.mjs";
import { createDashboardServer } from "./http-server.mjs";
import { ensureDedicatedCodex } from "./launcher.mjs";
import { CodexInjector } from "./injector.mjs";
import { CodexTaskAdapter } from "./task-adapter.mjs";
import { ZoteroAdapter } from "./zotero-adapter.mjs";
import { ZoteroCredentialStore } from "./zotero-credentials.mjs";
import { ZoteroLocalApi } from "./zotero-local-api.mjs";
import { DispatchBoardStore } from "./dispatch-board.mjs";
import { CodexCliDispatcher, DispatchScheduler } from "./dispatcher.mjs";
import { ContextWindowStore, ModelCatalog } from "./context-window.mjs";
import { prepareWrapperCodexHome } from "./wrapper-codex-home.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));

export async function run() {
  const config = getConfig();
  const wrapper = await prepareWrapperCodexHome({
    sourceHome: config.sourceCodexHome,
    wrapperHome: config.wrapperCodexHome,
    contextWindow: config.wrapperContextWindow
  });
  const adapter = new CodexTaskAdapter({
    sessionRoot: config.sessionRoot,
    archivedSessionRoot: config.archivedSessionRoot
  });
  const zoteroAdapter = new ZoteroAdapter({ databasePath: config.zoteroPath });
  const zoteroCredentials = new ZoteroCredentialStore({ filePath: config.zoteroCredentialPath });
  const zoteroLocalApi = new ZoteroLocalApi({
    baseUrl: config.zoteroLocalApiOrigin,
    credentialStore: zoteroCredentials
  });
  const dispatchStore = new DispatchBoardStore({ filePath: path.join(sourceDirectory, ".runtime", "dispatch-board.json") });
  const contextWindowStore = new ContextWindowStore({ filePath: path.join(sourceDirectory, ".runtime", "context-windows.json") });
  const modelCatalog = new ModelCatalog({ filePath: config.modelCatalogPath });
  await Promise.all([dispatchStore.init(), contextWindowStore.init()]);
  const dispatcher = new CodexCliDispatcher({
    codexPath: path.join(config.appPath, "Contents", "Resources", "codex"),
    codexHome: config.wrapperCodexHome,
    contextWindowStore
  });
  const scheduler = new DispatchScheduler({ store: dispatchStore, dispatcher });
  const dashboard = createDashboardServer({ config, adapter, zoteroAdapter, zoteroLocalApi, dispatchStore, contextWindowStore, modelCatalog });
  await dashboard.listen();
  let injector;
  try {
    const codex = await ensureDedicatedCodex(config);
    injector = new CodexInjector({ cdpOrigin: config.cdpOrigin, dashboardUrl: config.dashboardOrigin });
    await injector.start();
    scheduler.start();
    console.log(`[codex-control-console] dashboard listening at ${config.dashboardOrigin}`);
    console.log(`[codex-control-console] CDP ${codex.mode} on ${config.cdpOrigin}`);
    console.log(`[codex-control-console] dedicated profile: ${config.profileDirectory}`);
    console.log(`[codex-control-console] wrapper CODEX_HOME: ${wrapper.wrapperHome}`);
    console.log(`[codex-control-console] regular-chat context request: ${wrapper.requestedContextWindow}`);
  } catch (error) {
    zoteroAdapter.close();
    await dashboard.close();
    throw error;
  }

  const shutdown = async () => {
    await injector.stop();
    scheduler.stop();
    zoteroAdapter.close();
    await dashboard.close();
  };
  process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
  return { config, dashboard, injector, zoteroAdapter, zoteroLocalApi };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((error) => {
    console.error(`[codex-control-console] ${error.message}`);
    process.exitCode = 1;
  });
}
