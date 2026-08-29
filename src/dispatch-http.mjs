import { assertExactMutationOrigin, assertJsonContentType, decodePathSegment, readJsonBody, sendJson } from "./http-utils.mjs";

export function resolveDispatchTarget(tasks, { project, targetThreadId }) {
  const projectTasks = (tasks || []).filter((task) => task.project === project);
  if (targetThreadId) return projectTasks.find((task) => task.id === targetThreadId) || null;
  return projectTasks[0] || null;
}

export function createDispatchHttpHandler({ adapter, dispatchStore, dashboardOrigin }) {
  return async function handleDispatchRequest(request, response, requestUrl) {
    const isCollection = requestUrl.pathname === "/api/dispatches";
    const isItem = requestUrl.pathname.startsWith("/api/dispatches/");
    if (!isCollection && !isItem) return false;

    if (!dispatchStore) {
      sendJson(response, 503, { status: "error", message: "任务调度服务不可用" });
      return true;
    }
    if (isCollection && (request.method === "GET" || request.method === "HEAD")) {
      sendJson(response, 200, { status: "ok", items: dispatchStore.list() });
      return true;
    }

    const isMutation = (isCollection && request.method === "POST") || (isItem && ["PATCH", "DELETE"].includes(request.method));
    if (!isMutation) {
      sendJson(response, 405, { status: "error", message: "Method not allowed" });
      return true;
    }
    assertExactMutationOrigin(request, dashboardOrigin);
    if (isCollection && request.method === "POST") {
      assertJsonContentType(request);
      const input = await readJsonBody(request);
      const taskResult = await adapter.listTasks();
      const target = resolveDispatchTarget(taskResult.tasks, input);
      if (!target) {
        sendJson(response, 400, { status: "error", message: "所选项目或目标对话不可用" });
        return true;
      }
      const item = await dispatchStore.create({
        ...input,
        project: target.project,
        targetThreadId: target.id,
        targetThreadTitle: target.title,
        cwd: target.cwd
      });
      sendJson(response, 201, { status: "ok", item });
      return true;
    }
    if (isItem) {
      const id = decodePathSegment(requestUrl.pathname.slice("/api/dispatches/".length));
      if (request.method === "PATCH") {
        assertJsonContentType(request);
        const item = await dispatchStore.update(id, await readJsonBody(request));
        if (!item) sendJson(response, 404, { status: "error", message: "调度任务不存在" });
        else sendJson(response, 200, { status: "ok", item });
        return true;
      }
      if (request.method === "DELETE") {
        const removed = await dispatchStore.remove(id);
        sendJson(response, removed ? 200 : 404, removed ? { status: "ok" } : { status: "error", message: "调度任务不存在" });
        return true;
      }
    }
    return true;
  };
}
