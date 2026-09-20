import { assertExactMutationOrigin, assertJsonContentType, decodePathSegment, readJsonBody, sendJson } from "./http-utils.mjs";

export function resolveGeneratorTasks(tasks, inputs) {
  if (!Array.isArray(inputs) || !inputs.length) throw new Error("发生器至少需要一个任务");
  return inputs.map((input) => {
    if (!["existing_thread", "new_thread"].includes(input?.action)) throw new Error("任务动作无效");
    const projectTasks = (tasks || []).filter((task) => task.project === input?.project && task.cwd);
    if (!projectTasks.length) throw new Error(`项目“${String(input?.project || "").slice(0, 80)}”没有可用的本机会话`);
    if (input.action === "new_thread") {
      return { ...input, project: projectTasks[0].project, cwd: projectTasks[0].cwd, targetThreadId: null, targetThreadTitle: "新建会话" };
    }
    const target = projectTasks.find((task) => task.id === input.targetThreadId) || (!input.targetThreadId ? projectTasks[0] : null);
    if (!target) throw new Error("所选目标对话不可用");
    return { ...input, action: "existing_thread", project: target.project, cwd: target.cwd, targetThreadId: target.id, targetThreadTitle: target.title };
  });
}

export function createGeneratorHttpHandler({ adapter, generatorService, dashboardOrigin }) {
  return async function handleGeneratorRequest(request, response, requestUrl) {
    const collection = requestUrl.pathname === "/api/generators";
    const prefix = "/api/generators/";
    const itemPath = requestUrl.pathname.startsWith(prefix) ? requestUrl.pathname.slice(prefix.length) : null;
    if (!collection && itemPath === null) return false;
    if (!generatorService) {
      sendJson(response, 503, { status: "error", message: "发生器服务不可用" });
      return true;
    }
    if (collection && (request.method === "GET" || request.method === "HEAD")) {
      sendJson(response, 200, { status: "ok", ...generatorService.list() });
      return true;
    }
    const triggerSuffix = "/trigger";
    const trigger = itemPath?.endsWith(triggerSuffix);
    const mutation = (collection && request.method === "POST") || (trigger && request.method === "POST") || (!trigger && itemPath && request.method === "DELETE");
    if (!mutation) {
      sendJson(response, 405, { status: "error", message: "Method not allowed" });
      return true;
    }
    assertExactMutationOrigin(request, dashboardOrigin);
    if (collection) {
      assertJsonContentType(request);
      const input = await readJsonBody(request);
      try {
        const snapshot = await adapter.listTasks();
        const item = await generatorService.create({ ...input, tasks: resolveGeneratorTasks(snapshot.tasks, input.tasks) });
        sendJson(response, 201, { status: "ok", item });
      } catch (error) {
        sendJson(response, 400, { status: "error", message: error.message });
      }
      return true;
    }
    const encodedId = trigger ? itemPath.slice(0, -triggerSuffix.length) : itemPath;
    const id = decodePathSegment(encodedId);
    if (trigger) {
      assertJsonContentType(request);
      const input = await readJsonBody(request);
      try {
        const run = await generatorService.triggerManual(id, input.requestId);
        if (!run) sendJson(response, 404, { status: "error", message: "发生器不存在" });
        else sendJson(response, 202, { status: "ok", run: { id: run.id, generatorId: run.generatorId, source: run.source, triggeredAt: run.triggeredAt } });
      } catch (error) {
        sendJson(response, 400, { status: "error", message: error.message });
      }
      return true;
    }
    const removed = await generatorService.remove(id);
    sendJson(response, removed ? 200 : 404, removed ? { status: "ok" } : { status: "error", message: "发生器不存在" });
    return true;
  };
}
