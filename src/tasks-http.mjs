import { decodePathSegment, sendJson } from "./http-utils.mjs";
import { projectLocalNodeSnapshot } from "./peer-contract.mjs";

export function createTasksHttpHandler({ adapter, localAdapter = adapter }) {
  return async function handleTasksRequest(request, response, requestUrl) {
    const isNodeSnapshot = requestUrl.pathname === "/api/node/snapshot";
    const isCollection = requestUrl.pathname === "/api/tasks";
    const isItem = requestUrl.pathname.startsWith("/api/tasks/");
    if (!isNodeSnapshot && !isCollection && !isItem) return false;

    if (request.method !== "GET" && request.method !== "HEAD") {
      sendJson(response, 405, { status: "error", message: "Method not allowed" });
      return true;
    }
    if (isNodeSnapshot) {
      sendJson(response, 200, projectLocalNodeSnapshot(await localAdapter.listTasks()));
      return true;
    }
    if (isCollection) {
      sendJson(response, 200, await adapter.listTasks());
      return true;
    }

    const id = decodePathSegment(requestUrl.pathname.slice("/api/tasks/".length));
    const task = await adapter.getTask(id);
    if (!task) sendJson(response, 404, { status: "error", message: "任务不存在或已不可读" });
    else sendJson(response, 200, { status: "ok", task });
    return true;
  };
}
