import { decodePathSegment, sendJson } from "./http-utils.mjs";
import { projectLocalNodeSnapshot } from "./peer-contract.mjs";
import { projectTerminalConversations } from './terminal-conversation-projection.mjs';

export function createTasksHttpHandler({ adapter, localAdapter = adapter, nodeRuntimeService = null, terminalConversations = null, localDevice = null, nativeSidebarAdapter = null }) {
  let projects = [], projectsRead = 0, projectRead = null;
  async function readProjects() {
    if (!nativeSidebarAdapter || Date.now() - projectsRead < 5000) return projects;
    projectRead ||= nativeSidebarAdapter.read().then(value => { projects = value.projects; }).catch(() => {})
      .finally(() => { projectsRead = Date.now(); projectRead = null; });
    await projectRead; return projects;
  }
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
      const snapshot = await adapter.listTasks();
      let registry;
      try { registry = await terminalConversations?.list(); }
      catch {
        sendJson(response, 200, { ...snapshot, terminalConversations: [], terminalError: '终端会话档案暂不可读取，请稍后刷新；其他会话可正常管理。' });
        return true;
      }
      sendJson(response, 200, registry ? projectTerminalConversations(snapshot, registry, localDevice,
        registry.conversations.length ? await readProjects() : []) : snapshot);
      return true;
    }

    const id = decodePathSegment(requestUrl.pathname.slice("/api/tasks/".length));
    const task = await adapter.getTask(id);
    if (!task) sendJson(response, 404, { status: "error", message: "任务不存在或已不可读" });
    else sendJson(response, 200, { status: "ok", task });
    return true;
  };
}
