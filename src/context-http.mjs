import { describeContextOverride } from "./context-window.mjs";
import { assertExactMutationOrigin, assertJsonContentType, decodePathSegment, httpError, readJsonBody, sendJson } from "./http-utils.mjs";

export function createContextHttpHandler({ adapter, contextWindowStore, modelCatalog, dashboardOrigin }) {
  return async function handleContextRequest(request, response, requestUrl) {
    const isCollection = requestUrl.pathname === "/api/context-overrides";
    const isItem = requestUrl.pathname.startsWith("/api/context-overrides/");
    if (!isCollection && !isItem) return false;

    if (!contextWindowStore || !modelCatalog) {
      sendJson(response, 503, { status: "error", message: "会话上下文服务不可用" });
      return true;
    }
    if (isCollection) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        sendJson(response, 405, { status: "error", message: "Method not allowed" });
        return true;
      }
      const taskResult = await adapter.listTasks();
      const tasks = new Map((taskResult.tasks || []).map((task) => [task.id, task]));
      const items = await Promise.all(contextWindowStore.list().map((item) => describeContextOverride(item, tasks.get(item.threadId), modelCatalog)));
      sendJson(response, 200, { status: "ok", items });
      return true;
    }

    assertExactMutationOrigin(request, dashboardOrigin);
    const threadId = decodePathSegment(requestUrl.pathname.slice("/api/context-overrides/".length));
    if (request.method === "PUT") {
      assertJsonContentType(request);
      const body = await readJsonBody(request, 8 * 1024);
      const task = await adapter.getTask(threadId);
      if (!task) throw httpError(404, "会话不存在、已超出本机扫描范围或记录不可读");
      const item = await contextWindowStore.set(threadId, body.contextWindow);
      sendJson(response, 200, { status: "ok", item: await describeContextOverride(item, task, modelCatalog) });
      return true;
    }
    if (request.method === "DELETE") {
      const removed = await contextWindowStore.remove(threadId);
      sendJson(response, removed ? 200 : 404, removed ? { status: "ok" } : { status: "error", message: "该会话没有上下文覆盖" });
      return true;
    }
    sendJson(response, 405, { status: "error", message: "Method not allowed" });
    return true;
  };
}
