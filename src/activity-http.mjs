import { decodePathSegment, sendJson } from "./http-utils.mjs";

const THREAD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/;

function route(pathname) {
  const ownerPrefix = "/api/node/activity/";
  const taskPrefix = "/api/tasks/";
  if (pathname.startsWith(ownerPrefix)) return { owner: true, id: decodePathSegment(pathname.slice(ownerPrefix.length)) };
  if (pathname.startsWith(taskPrefix) && pathname.endsWith("/activity")) {
    return { owner: false, id: decodePathSegment(pathname.slice(taskPrefix.length, -"/activity".length)) };
  }
  return null;
}

export function createActivityHttpHandler({ adapter, localAdapter, remoteMessageService = null }) {
  return async function handleActivityRequest(request, response, requestUrl) {
    const match = route(requestUrl.pathname);
    if (!match) return false;
    if (request.method !== "GET" && request.method !== "HEAD") {
      sendJson(response, 405, { status: "error", message: "Method not allowed" });
      return true;
    }
    if (!THREAD_ID_PATTERN.test(match.id)) {
      sendJson(response, 400, { status: "error", message: "会话标识无效" });
      return true;
    }
    const deviceId = match.owner ? localAdapter.device?.id : requestUrl.searchParams.get("device");
    if (!deviceId) {
      sendJson(response, 400, { status: "error", message: "缺少会话所属设备" });
      return true;
    }
    let activity = match.owner ? await localAdapter.getActivity(match.id) : await adapter.getActivity(match.id, deviceId);
    if (match.owner && activity && remoteMessageService) {
      activity = { ...activity, draft: await remoteMessageService.readDraft(match.id) };
    }
    if (!activity) sendJson(response, 404, { status: "error", message: "会话不存在或已不可读" });
    else if (match.owner) sendJson(response, 200, activity);
    else sendJson(response, 200, { status: "ok", activity });
    return true;
  };
}
