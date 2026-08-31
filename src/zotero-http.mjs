import { assertExactMutationOrigin, assertJsonContentType, decodePathSegment, httpError, readJsonBody, sendJson } from "./http-utils.mjs";

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

function assertEmptyControlBody(body, message) {
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length) throw httpError(400, message);
}

export function createZoteroHttpHandler({ zoteroAdapter, zoteroLocalApi, dashboardOrigin }) {
  return async function handleZoteroRequest(request, response, requestUrl) {
    const { pathname } = requestUrl;
    if (!pathname.startsWith("/api/zotero")) return false;
    const isMutation = !["GET", "HEAD"].includes(request.method);
    if (isMutation) assertExactMutationOrigin(request, dashboardOrigin);

    if (pathname === "/api/zotero/status" && !isMutation) {
      if (!zoteroAdapter) {
        sendJson(response, 503, {
          status: "disconnected", source: "本机 Zotero", sourceType: "local-zotero-sqlite", readOnly: true,
          message: "Zotero 读取服务不可用。",
          counts: { items: 0, itemRows: 0, collections: 0, attachments: 0, notes: 0, libraries: 0, deletedItems: 0 }
        });
      } else sendJson(response, 200, await zoteroAdapter.getStatus());
      return true;
    }
    if (pathname === "/api/zotero/collections" && !isMutation) {
      if (!zoteroAdapter) sendJson(response, 503, { status: "disconnected", message: "Zotero 读取服务不可用。", collections: [] });
      else sendJson(response, 200, await zoteroAdapter.getCollections());
      return true;
    }
    if (pathname === "/api/zotero/items" && !isMutation) {
      if (!zoteroAdapter) sendJson(response, 503, { status: "disconnected", message: "Zotero 读取服务不可用。", items: [], total: 0, limit: 100, offset: 0, hasMore: false });
      else sendJson(response, 200, await zoteroAdapter.getItems({
        q: requestUrl.searchParams.get("q") || "",
        collection: requestUrl.searchParams.get("collection") || "",
        limit: requestUrl.searchParams.get("limit") || undefined,
        offset: requestUrl.searchParams.get("offset") || undefined
      }));
      return true;
    }
    if (pathname === "/api/zotero/write-status" && !isMutation) {
      sendZoteroResult(response, zoteroLocalApi ? await zoteroLocalApi.getWriteStatus() : emptyZoteroApiResult());
      return true;
    }
    if (pathname === "/api/zotero/authorize" && request.method === "POST") {
      assertJsonContentType(request);
      const body = await readJsonBody(request, 8 * 1024);
      assertEmptyControlBody(body, "授权请求字段无效");
      sendZoteroResult(response, zoteroLocalApi ? await zoteroLocalApi.authorize() : emptyZoteroApiResult());
      return true;
    }
    if (pathname === "/api/zotero/forget-authorization" && request.method === "POST") {
      assertJsonContentType(request);
      const body = await readJsonBody(request, 8 * 1024);
      assertEmptyControlBody(body, "忘记授权请求字段无效");
      sendZoteroResult(response, zoteroLocalApi ? await zoteroLocalApi.forgetAuthorization() : { status: "forgot", authorization: "required", message: "已忘记本地回写授权。", httpStatus: 200 });
      return true;
    }

    const editMatch = pathname.match(/^\/api\/zotero\/edit\/([^/]+)$/);
    if (editMatch && request.method === "GET") {
      sendZoteroResult(response, zoteroLocalApi ? await zoteroLocalApi.getEditableItem(decodePathSegment(editMatch[1])) : emptyZoteroApiResult());
      return true;
    }
    if (editMatch && request.method === "PATCH") {
      assertJsonContentType(request);
      const body = await readJsonBody(request, 256 * 1024);
      sendZoteroResult(response, zoteroLocalApi ? await zoteroLocalApi.updateItem(decodePathSegment(editMatch[1]), body) : emptyZoteroApiResult());
      return true;
    }
    if (pathname === "/api/zotero/items" && request.method === "POST") {
      assertJsonContentType(request);
      const body = await readJsonBody(request, 256 * 1024);
      sendZoteroResult(response, zoteroLocalApi ? await zoteroLocalApi.createItem(body) : emptyZoteroApiResult(), 201);
      return true;
    }
    const noteMatch = pathname.match(/^\/api\/zotero\/items\/([^/]+)\/notes$/);
    if (noteMatch && request.method === "POST") {
      assertJsonContentType(request);
      const body = await readJsonBody(request, 256 * 1024);
      sendZoteroResult(response, zoteroLocalApi ? await zoteroLocalApi.addNote(decodePathSegment(noteMatch[1]), body) : emptyZoteroApiResult(), 201);
      return true;
    }
    if (pathname === "/api/zotero/collections" && request.method === "POST") {
      assertJsonContentType(request);
      const body = await readJsonBody(request, 32 * 1024);
      sendZoteroResult(response, zoteroLocalApi ? await zoteroLocalApi.createCollection(body) : emptyZoteroApiResult(), 201);
      return true;
    }

    sendJson(response, isMutation ? 405 : 404, { status: "error", message: isMutation ? "Method not allowed" : "Not found" });
    return true;
  };
}
