import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertLoopbackConfig } from "./loopback.mjs";
import { describeContextOverride } from "./context-window.mjs";

const publicDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");
const assetMap = new Map([
  ["/", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/index.html", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/styles.css", { file: "styles.css", type: "text/css; charset=utf-8" }],
  ["/app.js", { file: "app.js", type: "text/javascript; charset=utf-8" }],
  ["/features/sessions/index.js", { file: "features/sessions/index.js", type: "text/javascript; charset=utf-8" }]
]);

function sendJson(response, statusCode, body) {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(payload);
}

async function readJsonBody(request, maxBytes = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw httpError(413, "请求内容过大");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw httpError(400, "请求 JSON 无效");
  }
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function assertMutationOrigin(request, dashboardOrigin) {
  const origin = request.headers.origin;
  if (origin && origin !== dashboardOrigin) throw new Error("不允许的请求来源");
}

function assertExactMutationOrigin(request, dashboardOrigin) {
  if (request.headers.origin !== dashboardOrigin) throw httpError(403, "需要控制台页面的精确请求来源");
}

function assertJsonContentType(request) {
  if (!String(request.headers["content-type"] || "").toLowerCase().includes("application/json")) {
    throw httpError(415, "请求必须使用 application/json");
  }
}

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

function decodePathSegment(value) {
  try { return decodeURIComponent(value); } catch { throw httpError(400, "路径标识无效"); }
}

export function resolveDispatchTarget(tasks, { project, targetThreadId }) {
  const projectTasks = (tasks || []).filter((task) => task.project === project);
  if (targetThreadId) return projectTasks.find((task) => task.id === targetThreadId) || null;
  return projectTasks[0] || null;
}

export function createDashboardServer({ config, adapter, zoteroAdapter = null, zoteroLocalApi = null, dispatchStore = null, contextWindowStore = null, modelCatalog = null, logger = console }) {
  assertLoopbackConfig(config);
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
      if (requestUrl.pathname === "/api/context-overrides") {
        if (!contextWindowStore || !modelCatalog) {
          sendJson(response, 503, { status: "error", message: "会话上下文服务不可用" });
          return;
        }
        if (request.method !== "GET" && request.method !== "HEAD") {
          sendJson(response, 405, { status: "error", message: "Method not allowed" });
          return;
        }
        const taskResult = await adapter.listTasks();
        const tasks = new Map((taskResult.tasks || []).map((task) => [task.id, task]));
        const items = await Promise.all(contextWindowStore.list().map((item) => describeContextOverride(item, tasks.get(item.threadId), modelCatalog)));
        sendJson(response, 200, { status: "ok", items });
        return;
      }
      if (requestUrl.pathname.startsWith("/api/context-overrides/")) {
        if (!contextWindowStore || !modelCatalog) {
          sendJson(response, 503, { status: "error", message: "会话上下文服务不可用" });
          return;
        }
        assertExactMutationOrigin(request, config.dashboardOrigin);
        const threadId = decodeURIComponent(requestUrl.pathname.slice("/api/context-overrides/".length));
        if (request.method === "PUT") {
          assertJsonContentType(request);
          const body = await readJsonBody(request, 8 * 1024);
          const task = await adapter.getTask(threadId);
          if (!task) throw httpError(404, "会话不存在、已超出本机扫描范围或记录不可读");
          const item = await contextWindowStore.set(threadId, body.contextWindow);
          sendJson(response, 200, { status: "ok", item: await describeContextOverride(item, task, modelCatalog) });
          return;
        }
        if (request.method === "DELETE") {
          const removed = await contextWindowStore.remove(threadId);
          sendJson(response, removed ? 200 : 404, removed ? { status: "ok" } : { status: "error", message: "该会话没有上下文覆盖" });
          return;
        }
        sendJson(response, 405, { status: "error", message: "Method not allowed" });
        return;
      }
      if (requestUrl.pathname === "/api/dispatches") {
        if (!dispatchStore) {
          sendJson(response, 503, { status: "error", message: "任务调度服务不可用" });
          return;
        }
        if (request.method === "GET" || request.method === "HEAD") {
          sendJson(response, 200, { status: "ok", items: dispatchStore.list() });
          return;
        }
        if (request.method === "POST") {
          assertMutationOrigin(request, config.dashboardOrigin);
          const input = await readJsonBody(request);
          const taskResult = await adapter.listTasks();
          const target = resolveDispatchTarget(taskResult.tasks, input);
          if (!target) {
            sendJson(response, 400, { status: "error", message: "所选项目或目标对话不可用" });
            return;
          }
          const item = await dispatchStore.create({
            ...input,
            project: target.project,
            targetThreadId: target.id,
            targetThreadTitle: target.title,
            cwd: target.cwd
          });
          sendJson(response, 201, { status: "ok", item });
          return;
        }
        sendJson(response, 405, { status: "error", message: "Method not allowed" });
        return;
      }
      if (requestUrl.pathname.startsWith("/api/dispatches/")) {
        if (!dispatchStore) {
          sendJson(response, 503, { status: "error", message: "任务调度服务不可用" });
          return;
        }
        assertMutationOrigin(request, config.dashboardOrigin);
        const id = decodeURIComponent(requestUrl.pathname.slice("/api/dispatches/".length));
        if (request.method === "PATCH") {
          const item = await dispatchStore.update(id, await readJsonBody(request));
          if (!item) sendJson(response, 404, { status: "error", message: "调度任务不存在" });
          else sendJson(response, 200, { status: "ok", item });
          return;
        }
        if (request.method === "DELETE") {
          const removed = await dispatchStore.remove(id);
          sendJson(response, removed ? 200 : 404, removed ? { status: "ok" } : { status: "error", message: "调度任务不存在" });
          return;
        }
        sendJson(response, 405, { status: "error", message: "Method not allowed" });
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        sendJson(response, 405, { status: "error", message: "Method not allowed" });
        return;
      }
      const asset = assetMap.get(requestUrl.pathname);
      if (!asset) {
        sendJson(response, 404, { status: "error", message: "Not found" });
        return;
      }
      const content = await fs.readFile(path.join(publicDirectory, asset.file));
      response.writeHead(200, {
        "content-type": asset.type,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'"
      });
      if (request.method === "HEAD") response.end();
      else response.end(content);
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
