import http from "node:http";
import { assertLoopbackConfig } from "./loopback.mjs";
import { serveStaticAsset } from "./static-assets.mjs";
import { createContextHttpHandler } from "./context-http.mjs";
import { createDispatchHttpHandler } from "./dispatch-http.mjs";
import { assertExactMutationOrigin, assertJsonContentType, decodePathSegment, readJsonBody, sendJson } from "./http-utils.mjs";

function sendZoteroResult(response, result, fallbackStatus = 200) {
  const { httpStatus, ...body } = result || { status: "error", message: "Zotero 服务不可用。" };
  sendJson(response, httpStatus || fallbackStatus, body);
}

function emptyZoteroApiResult() {
  return {
    status: "offline",
    connected: false,
    authorization: "unavailable",
    localApi: "offline",
    readOnlyAvailable: true,
    writeEnabled: false,
    message: "Zotero 回写服务尚未配置。请启动或配置 Zotero 后重试。",
    httpStatus: 503
  };
}

export function createDashboardServer({ config, adapter, zoteroAdapter = null, zoteroLocalApi = null, dispatchStore = null, contextWindowStore = null, modelCatalog = null, logger = console }) {
  assertLoopbackConfig(config);
  const handleContextRequest = createContextHttpHandler({ adapter, contextWindowStore, modelCatalog, dashboardOrigin: config.dashboardOrigin });
  const handleDispatchRequest = createDispatchHttpHandler({ adapter, dispatchStore, dashboardOrigin: config.dashboardOrigin });
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
      if (requestUrl.pathname.startsWith("/api/zotero")) {
        const pathname = requestUrl.pathname;
        const isMutation = !["GET", "HEAD"].includes(request.method);
        if (isMutation) assertExactMutationOrigin(request, config.dashboardOrigin);

        if (pathname === "/api/zotero/status" && !isMutation) {
          if (!zoteroAdapter) {
            sendJson(response, 503, {
              status: "disconnected",
              source: "本机 Zotero",
              sourceType: "local-zotero-sqlite",
              readOnly: true,
              message: "Zotero 读取服务不可用。",
              counts: { items: 0, itemRows: 0, collections: 0, attachments: 0, notes: 0, libraries: 0, deletedItems: 0 }
            });
          } else sendJson(response, 200, await zoteroAdapter.getStatus());
          return;
        }
        if (pathname === "/api/zotero/collections" && !isMutation) {
          if (!zoteroAdapter) sendJson(response, 503, { status: "disconnected", message: "Zotero 读取服务不可用。", collections: [] });
          else sendJson(response, 200, await zoteroAdapter.getCollections());
          return;
        }
        if (pathname === "/api/zotero/items" && !isMutation) {
          if (!zoteroAdapter) sendJson(response, 503, { status: "disconnected", message: "Zotero 读取服务不可用。", items: [], total: 0, limit: 100, offset: 0, hasMore: false });
          else sendJson(response, 200, await zoteroAdapter.getItems({
            q: requestUrl.searchParams.get("q") || "",
            collection: requestUrl.searchParams.get("collection") || "",
            limit: requestUrl.searchParams.get("limit") || undefined,
            offset: requestUrl.searchParams.get("offset") || undefined
          }));
          return;
        }
        if (pathname === "/api/zotero/write-status" && !isMutation) {
          sendZoteroResult(response, zoteroLocalApi ? await zoteroLocalApi.getWriteStatus() : emptyZoteroApiResult());
          return;
        }
        if (pathname === "/api/zotero/authorize" && request.method === "POST") {
          assertJsonContentType(request);
          const body = await readJsonBody(request, 8 * 1024);
          if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length) throw httpError(400, "授权请求字段无效");
          sendZoteroResult(response, zoteroLocalApi ? await zoteroLocalApi.authorize() : emptyZoteroApiResult());
          return;
        }
        if (pathname === "/api/zotero/forget-authorization" && request.method === "POST") {
          assertJsonContentType(request);
          const body = await readJsonBody(request, 8 * 1024);
          if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length) throw httpError(400, "忘记授权请求字段无效");
          sendZoteroResult(response, zoteroLocalApi ? await zoteroLocalApi.forgetAuthorization() : { status: "forgot", authorization: "required", message: "已忘记本地回写授权。", httpStatus: 200 });
          return;
        }
        const editMatch = pathname.match(/^\/api\/zotero\/edit\/([^/]+)$/);
        if (editMatch && request.method === "GET") {
          const key = decodePathSegment(editMatch[1]);
          sendZoteroResult(response, zoteroLocalApi ? await zoteroLocalApi.getEditableItem(key) : emptyZoteroApiResult());
          return;
        }
        if (editMatch && request.method === "PATCH") {
          assertJsonContentType(request);
          const body = await readJsonBody(request, 256 * 1024);
          sendZoteroResult(response, zoteroLocalApi ? await zoteroLocalApi.updateItem(decodePathSegment(editMatch[1]), body) : emptyZoteroApiResult());
          return;
        }
        if (pathname === "/api/zotero/items" && request.method === "POST") {
          assertJsonContentType(request);
          const body = await readJsonBody(request, 256 * 1024);
          sendZoteroResult(response, zoteroLocalApi ? await zoteroLocalApi.createItem(body) : emptyZoteroApiResult(), 201);
          return;
        }
        const noteMatch = pathname.match(/^\/api\/zotero\/items\/([^/]+)\/notes$/);
        if (noteMatch && request.method === "POST") {
          assertJsonContentType(request);
          const body = await readJsonBody(request, 256 * 1024);
          sendZoteroResult(response, zoteroLocalApi ? await zoteroLocalApi.addNote(decodePathSegment(noteMatch[1]), body) : emptyZoteroApiResult(), 201);
          return;
        }
        if (pathname === "/api/zotero/collections" && request.method === "POST") {
          assertJsonContentType(request);
          const body = await readJsonBody(request, 32 * 1024);
          sendZoteroResult(response, zoteroLocalApi ? await zoteroLocalApi.createCollection(body) : emptyZoteroApiResult(), 201);
          return;
        }
        sendJson(response, isMutation ? 405 : 404, { status: "error", message: isMutation ? "Method not allowed" : "Not found" });
        return;
      }
      if (requestUrl.pathname === "/api/tasks") {
        sendJson(response, 200, await adapter.listTasks());
        return;
      }
      if (requestUrl.pathname.startsWith("/api/tasks/")) {
        const id = decodeURIComponent(requestUrl.pathname.slice("/api/tasks/".length));
        const task = await adapter.getTask(id);
        if (!task) {
          sendJson(response, 404, { status: "error", message: "任务不存在或已不可读" });
          return;
        }
        sendJson(response, 200, { status: "ok", task });
        return;
      }
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
