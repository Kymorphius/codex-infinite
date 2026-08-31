import { assertExactMutationOrigin, assertJsonContentType, decodePathSegment, httpError, readJsonBody, readRequestBody, sendJson } from "./http-utils.mjs";
import { loadActionKey, NonceReplayWindow, verifyPeerAction } from "./peer-action-auth.mjs";

const OWNER_PATHS = Object.freeze({
  "/api/node/actions/message": "message",
  "/api/node/actions/control": "control",
  "/api/node/actions/settings": "settings"
});

function browserRoute(pathname) {
  const prefix = "/api/tasks/";
  if (!pathname.startsWith(prefix)) return null;
  for (const [suffix, kind] of [["/messages", "message"], ["/control", "control"], ["/settings", "settings"]]) {
    if (pathname.endsWith(suffix)) return { kind, threadId: decodePathSegment(pathname.slice(prefix.length, -suffix.length)) };
  }
  return null;
}

function parseBody(body) {
  try { return JSON.parse(body.toString("utf8") || "{}"); }
  catch { throw httpError(400, "请求 JSON 无效"); }
}

export function createPeerActionHttpHandler({ adapter, remoteMessageService, remoteThreadSettingsService, dashboardOrigin, nodeActionKeyPath, replayWindow = new NonceReplayWindow() }) {
  return async function handlePeerActionRequest(request, response, requestUrl) {
    const ownerKind = OWNER_PATHS[requestUrl.pathname] || null;
    const browser = ownerKind ? null : browserRoute(requestUrl.pathname);
    if (!ownerKind && !browser) return false;
    if (request.method !== "POST") {
      sendJson(response, 405, { status: "error", message: "Method not allowed" });
      return true;
    }
    assertJsonContentType(request);
    if (!ownerKind) {
      assertExactMutationOrigin(request, dashboardOrigin);
      const deviceId = requestUrl.searchParams.get("device");
      if (!deviceId) throw httpError(400, "缺少会话所属设备");
      const input = await readJsonBody(request, 16 * 1024);
      const result = browser.kind === "message"
        ? await adapter.sendMessage(browser.threadId, deviceId, input.prompt, input.expectedDraftRevision)
        : browser.kind === "control"
          ? await adapter.control(browser.threadId, deviceId, input)
          : await adapter.updateSettings(browser.threadId, deviceId, input.changes);
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
    const input = parseBody(body);
    const result = ownerKind === "message"
      ? await remoteMessageService.submit(input)
      : ownerKind === "control"
        ? await remoteMessageService.control(input)
        : await remoteThreadSettingsService.update(input);
    sendJson(response, 202, { status: "ok", ...result });
    return true;
  };
}
