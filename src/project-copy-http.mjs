import { assertExactMutationOrigin, assertJsonContentType, readJsonBody, sendJson } from "./http-utils.mjs";

export function createProjectCopyHttpHandler({ service, dashboardOrigin }) {
  return async function handleProjectCopy(request, response, requestUrl) {
    if (requestUrl.pathname === "/api/project-copy/options") {
      if (request.method !== "GET" && request.method !== "HEAD") { sendJson(response, 405, { status: "error", message: "Method not allowed" }); return true; }
      sendJson(response, 200, { status: "ok", ...service.options() });
      return true;
    }
    const action = requestUrl.pathname === "/api/project-copy/preflight" ? "preflight" : requestUrl.pathname === "/api/project-copy/execute" ? "execute" : null;
    if (!action) return false;
    if (request.method !== "POST") { sendJson(response, 405, { status: "error", message: "Method not allowed" }); return true; }
    assertExactMutationOrigin(request, dashboardOrigin);
    assertJsonContentType(request);
    try {
      const result = await service[action](await readJsonBody(request, 8 * 1024));
      sendJson(response, 200, { status: "ok", ...result });
    } catch (error) {
      sendJson(response, error.statusCode || 400, { status: "error", message: error.message });
    }
    return true;
  };
}
