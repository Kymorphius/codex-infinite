import { assertExactMutationOrigin, httpError, readJsonBody, readRequestBody, sendJson } from "./http-utils.mjs";
import { loadActionKey, NonceReplayWindow, verifyPeerAction } from "./peer-action-auth.mjs";
import { PROJECT_SYNC_ACTIONS, PROJECT_SYNC_NODE_PREFIX, PROJECT_SYNC_PACKAGE_BYTES, PROJECT_SYNC_SMALL_BODY_BYTES } from "./project-sync-peer-commands.mjs";

const BROWSER_PATHS = Object.freeze({
  "/api/project-sync/catalog": "catalog",
  "/api/project-sync/preflight": "preflight",
  "/api/project-sync/execute": "execute"
});

function assertJson(request) {
  if (String(request.headers["content-type"] || "").split(";")[0].trim().toLowerCase() !== "application/json") throw httpError(415, "请求必须使用 application/json");
}

function assertInput(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw httpError(400, "项目同步请求必须为 JSON 对象");
  return input;
}

export function createProjectSyncHttpHandler({ service, localAdapter, dashboardOrigin, nodeActionKeyPath, replayWindow = new NonceReplayWindow() }) {
  return async function handleProjectSync(request, response, requestUrl) {
    const nodeAction = requestUrl.pathname.startsWith(PROJECT_SYNC_NODE_PREFIX) ? requestUrl.pathname.slice(PROJECT_SYNC_NODE_PREFIX.length) : null;
    const node = PROJECT_SYNC_ACTIONS.includes(nodeAction);
    const browserAction = BROWSER_PATHS[requestUrl.pathname];
    if (!node && !browserAction) return false;
    const expectedMethod = !node && browserAction === "catalog" ? "GET" : "POST";
    if (request.method !== expectedMethod) {
      sendJson(response, 405, { status: "error", message: "Method not allowed" });
      return true;
    }
    if (!node) {
      if (!service) throw httpError(503, "项目同步服务未配置");
      let input;
      if (expectedMethod === "POST") {
        assertExactMutationOrigin(request, dashboardOrigin);
        assertJson(request);
        input = assertInput(await readJsonBody(request, PROJECT_SYNC_SMALL_BODY_BYTES));
      }
      const result = await service[browserAction](input);
      sendJson(response, 200, { status: "ok", ...result });
      return true;
    }
    if (request.headers.origin !== undefined || Object.keys(request.headers).some((name) => name.startsWith("sec-fetch-"))) throw httpError(403, "项目同步节点接口仅接受设备通道请求");
    assertJson(request);
    if (!localAdapter) throw httpError(503, "本机项目同步服务未配置");
    const body = await readRequestBody(request, nodeAction === "prepare" ? PROJECT_SYNC_PACKAGE_BYTES : PROJECT_SYNC_SMALL_BODY_BYTES);
    const key = await loadActionKey(nodeActionKeyPath);
    const verification = verifyPeerAction({ key, method: request.method, path: requestUrl.pathname, headers: request.headers, body, replayWindow });
    if (!verification.ok) throw httpError(401, "项目同步节点认证失败");
    if (verification.duplicate) throw httpError(409, "项目同步请求已使用，请重新预检");
    let input;
    try { input = JSON.parse(body.toString("utf8") || "{}"); }
    catch { throw httpError(400, "请求 JSON 无效"); }
    const result = await localAdapter[nodeAction](assertInput(input));
    const payload = { status: "ok", result };
    const maxResponseBytes = nodeAction === "export" ? PROJECT_SYNC_PACKAGE_BYTES : nodeAction === "catalog" ? 2 * 1024 * 1024 : 64 * 1024;
    if (Buffer.byteLength(JSON.stringify(payload), "utf8") > maxResponseBytes) throw httpError(502, "项目同步响应过大");
    sendJson(response, 200, payload);
    return true;
  };
}
