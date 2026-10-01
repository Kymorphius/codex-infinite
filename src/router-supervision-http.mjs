import { assertExactMutationOrigin, assertJsonContentType, readJsonBody, sendJson, httpError } from "./http-utils.mjs";

export function createRouterSupervisionHttpHandler({ supervisor, dashboardOrigin }) {
  return async (request, response, url) => {
    if (!["/api/router/status", "/api/router/repair"].includes(url.pathname)) return false;
    if (!supervisor) throw httpError(503, "Router 监管服务尚未就绪");
    if (url.pathname === "/api/router/status") {
      if (request.method !== "GET") { sendJson(response, 405, { message: "Method not allowed" }); return true; }
      sendJson(response, 200, await supervisor.read());
      return true;
    }
    if (request.method !== "POST") { sendJson(response, 405, { message: "Method not allowed" }); return true; }
    assertExactMutationOrigin(request, dashboardOrigin); assertJsonContentType(request);
    const body = await readJsonBody(request, 1024);
    if (!body || body.confirm !== true || Object.keys(body).some((key) => key !== "confirm")) throw httpError(400, "请确认修复 Router");
    sendJson(response, 202, await supervisor.repair());
    return true;
  };
}
