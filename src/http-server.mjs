import http from "node:http";
import { assertLoopbackConfig } from "./loopback.mjs";
import { serveStaticAsset } from "./static-assets.mjs";
import { createDashboardHandlers } from "./dashboard-handlers.mjs";
import { sendJson } from "./http-utils.mjs";

export function createDashboardServer({ config, adapter, local = adapter, remoteMessageService = null, zoteroAdapter = null, zoteroLocalApi = null, dispatchStore = null, contextWindowStore = null, modelCatalog = null, logger = console }) {
  assertLoopbackConfig(config);
  const handlers = createDashboardHandlers({ config, adapter, local, remoteMessageService, zoteroAdapter, zoteroLocalApi, dispatchStore, contextWindowStore, modelCatalog });
  const server = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url || "/", config.dashboardOrigin);
      for (const handler of handlers) if (await handler(request, response, requestUrl)) return;
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
