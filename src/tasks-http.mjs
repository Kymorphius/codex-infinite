import { decodePathSegment, sendJson } from "./http-utils.mjs";
import { projectLocalNodeSnapshot } from "./peer-contract.mjs";

export function createTasksHttpHandler({ adapter, localAdapter = adapter, nodeRuntimeService = null }) {
  return async function handleTasksRequest(request, response, requestUrl) {
    const isNodeSnapshot = requestUrl.pathname === "/api/node/snapshot";
    const isCollection = requestUrl.pathname === "/api/tasks";
    const isItem = requestUrl.pathname.startsWith("/api/tasks/") && !requestUrl.pathname.endsWith("/activity");
    if (!isNodeSnapshot && !isCollection && !isItem) return false;

    if (request.method !== "GET" && request.method !== "HEAD") {
      sendJson(response, 405, { status: "error", message: "Method not allowed" });
      return true;
    }
    if (isNodeSnapshot) {
      const [tasks, runtime] = await Promise.all([
        localAdapter.listTasks(),
        nodeRuntimeService?.read?.()
      ]);
      sendJson(response, 200, projectLocalNodeSnapshot(tasks, runtime));
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
