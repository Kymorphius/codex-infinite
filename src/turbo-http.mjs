import { assertExactMutationOrigin, assertJsonContentType, httpError, readJsonBody, readRequestBody, sendJson } from "./http-utils.mjs";
import { loadActionKey, NonceReplayWindow, verifyPeerAction } from "./peer-action-auth.mjs";
import { validateTurboChange } from "./turbo-control.mjs";

const OWNER_PATH = "/api/node/actions/turbo";
const BROWSER_ACTIONS = Object.freeze({ "/api/turbo": "update", "/api/turbo/save": "save", "/api/turbo/sync": "sync" });

function policyResponse(policy = {}) {
  return {
    enabled: policy.enabled === true,
    model: typeof policy.model === "string" ? policy.model : null,
    reasoningEffort: typeof policy.reasoningEffort === "string" ? policy.reasoningEffort : "maximum",
    fast: policy.fast !== false,
    millionContext: policy.millionContext === true,
    autoDisableGlobalRouting: policy.autoDisableGlobalRouting === true,
    accessMode: typeof policy.accessMode === "string" ? policy.accessMode : "preserve",
    deviceIds: Array.isArray(policy.deviceIds) ? policy.deviceIds : [],
    updatedAt: policy.updatedAt || null
  };
}

function parseBody(body) {
  try { return JSON.parse(body.toString("utf8") || "{}"); }
  catch { throw httpError(400, "请求 JSON 无效"); }
}

export function createTurboHttpHandler({ turboCoordinator, turboPolicyService, dashboardOrigin, nodeActionKeyPath, replayWindow = new NonceReplayWindow() } = {}) {
  return async function handleTurboRequest(request, response, requestUrl) {
    const browserAction = BROWSER_ACTIONS[requestUrl.pathname];
    const browser = Boolean(browserAction);
    const owner = requestUrl.pathname === OWNER_PATH;
    if (!browser && !owner) return false;
    if (requestUrl.pathname === "/api/turbo" && (request.method === "GET" || request.method === "HEAD")) {
      sendJson(response, 200, { status: "ok", ...turboCoordinator.read() });
      return true;
    }
    if (browser && request.method === "PUT") {
      assertExactMutationOrigin(request, dashboardOrigin);
      assertJsonContentType(request);
      const change = validateTurboChange(await readJsonBody(request, 2048), { allowRequestId: false });
      const result = await turboCoordinator[browserAction](change);
      sendJson(response, result.converged ? 200 : 207, { status: "ok", ...result });
      return true;
    }
    if (owner && request.method === "POST") {
      assertJsonContentType(request);
      const body = await readRequestBody(request, 2048);
      const key = await loadActionKey(nodeActionKeyPath);
      const verification = verifyPeerAction({ key, method: request.method, path: requestUrl.pathname, headers: request.headers, body, replayWindow });
      if (!verification.ok) throw httpError(401, "节点操作认证失败");
      if (verification.duplicate) {
        const policy = turboPolicyService.snapshot();
        sendJson(response, 202, { status: "ok", accepted: true, duplicate: true, ...policyResponse(policy) });
        return true;
      }
      const change = validateTurboChange(parseBody(body));
      let policy;
      try { policy = await turboCoordinator.receive(change); }
      catch (error) {
        if (error.code !== "TURBO_PEER_BUSY") throw error;
        sendJson(response, 409, { status: "error", code: "TURBO_PEER_BUSY", message: "本机正在保存或同步 Turbo 设置，请稍后重试" });
        return true;
      }
      sendJson(response, 202, { status: "ok", accepted: true, ...policyResponse(policy) });
      return true;
    }
    sendJson(response, 405, { status: "error", message: "Method not allowed" });
    return true;
  };
}
