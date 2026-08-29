import http from "node:http";
import { assertLoopbackConfig } from "./loopback.mjs";
import { serveStaticAsset } from "./static-assets.mjs";
import { createContextHttpHandler } from "./context-http.mjs";
import { createDispatchHttpHandler } from "./dispatch-http.mjs";
import { createTasksHttpHandler } from "./tasks-http.mjs";
import { createZoteroHttpHandler } from "./zotero-http.mjs";
import { sendJson } from "./http-utils.mjs";

export function createDashboardServer({ config, adapter, zoteroAdapter = null, zoteroLocalApi = null, dispatchStore = null, contextWindowStore = null, modelCatalog = null, logger = console }) {
  assertLoopbackConfig(config);
  const handleContextRequest = createContextHttpHandler({ adapter, contextWindowStore, modelCatalog, dashboardOrigin: config.dashboardOrigin });
  const handleDispatchRequest = createDispatchHttpHandler({ adapter, dispatchStore, dashboardOrigin: config.dashboardOrigin });
  const handleTasksRequest = createTasksHttpHandler({ adapter });
  const handleZoteroRequest = createZoteroHttpHandler({ zoteroAdapter, zoteroLocalApi, dashboardOrigin: config.dashboardOrigin });
  const server = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url || "/", config.dashboardOrigin);
      if (requestUrl.pathname === "/api/health") {
        sendJson(response, 200, {
          status: "ok",
          dashboardOrigin: config.dashboardOrigin,
          cdpOrigin: config.cdpOrigin,
          profileDirectory: config.profileDirectory,
          wrapperContextWindow: config.wrapperContextWindow || null,
          regularChatExtendedContext: Boolean(config.wrapperCodexHome && config.wrapperContextWindow),
          taskAdapter: "codex-session-metadata-read-only"
        });
        return;
      }
      if (await handleZoteroRequest(request, response, requestUrl)) return;
      if (await handleTasksRequest(request, response, requestUrl)) return;
      if (await handleContextRequest(request, response, requestUrl)) return;
      if (await handleDispatchRequest(request, response, requestUrl)) return;
      if (request.method !== "GET" && request.method !== "HEAD") {
        sendJson(response, 405, { status: "error", message: "Method not allowed" });
        return;
      }
      if (!await serveStaticAsset(request, response)) {
        sendJson(response, 404, { status: "error", message: "Not found" });
      }
    } catch (error) {
      if (!response.headersSent) sendJson(response, error.statusCode || 500, { status: "error", message: error.statusCode ? error.message : "控制台服务内部错误" });
      else response.end();
    }
  });

  return {
    server,
    listen() {
      return new Promise((resolve, reject) => {
        const onError = (error) => { server.off("listening", onListening); reject(error); };
        const onListening = () => { server.off("error", onError); resolve(server); };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(config.dashboardPort, config.dashboardHost);
      });
    },
    close() {
      return new Promise((resolve) => {
        if (!server.listening) return resolve();
        server.close(() => resolve());
      });
    }
  };
}
