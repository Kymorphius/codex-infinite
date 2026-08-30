import { assertExactMutationOrigin, assertJsonContentType, decodePathSegment, httpError, readJsonBody, readRequestBody, sendJson } from "./http-utils.mjs";
import { loadActionKey, NonceReplayWindow, verifyPeerAction } from "./peer-action-auth.mjs";

const OWNER_PATH = "/api/node/actions/message";

function browserThreadId(pathname) {
  const prefix = "/api/tasks/";
  const suffix = "/messages";
  if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) return null;
  return decodePathSegment(pathname.slice(prefix.length, -suffix.length));
}

function parseBody(body) {
  try { return JSON.parse(body.toString("utf8") || "{}"); }
  catch { throw httpError(400, "请求 JSON 无效"); }
}

export function createPeerActionHttpHandler({ adapter, remoteMessageService, dashboardOrigin, nodeActionKeyPath, replayWindow = new NonceReplayWindow() }) {
  return async function handlePeerActionRequest(request, response, requestUrl) {
    const isOwner = requestUrl.pathname === OWNER_PATH;
    const threadId = isOwner ? null : browserThreadId(requestUrl.pathname);
    if (!isOwner && threadId === null) return false;
    if (request.method !== "POST") {
      sendJson(response, 405, { status: "error", message: "Method not allowed" });
      return true;
    }
    assertJsonContentType(request);
    if (!isOwner) {
      assertExactMutationOrigin(request, dashboardOrigin);
      const deviceId = requestUrl.searchParams.get("device");
      if (!deviceId) throw httpError(400, "缺少会话所属设备");
      const input = await readJsonBody(request, 16 * 1024);
      const result = await adapter.sendMessage(threadId, deviceId, input.prompt, input.expectedDraftRevision);
      if (!result) throw httpError(404, "会话所属节点不可用");
      sendJson(response, 202, { status: "ok", ...result });
      return true;
    }

    const body = await readRequestBody(request, 16 * 1024);
    const key = await loadActionKey(nodeActionKeyPath);
    const verification = verifyPeerAction({ key, method: request.method, path: requestUrl.pathname, headers: request.headers, body, replayWindow });
    if (!verification.ok) throw httpError(401, "节点操作认证失败");
    if (verification.duplicate) {
      sendJson(response, 202, { status: "ok", accepted: true, duplicate: true });
      return true;
    }
    const result = await remoteMessageService.submit(parseBody(body));
    sendJson(response, 202, { status: "ok", ...result });
    return true;
  };
}
