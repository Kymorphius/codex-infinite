import { assertExactMutationOrigin, assertJsonContentType, httpError, readJsonBody, sendJson } from "./http-utils.mjs";

export function createNativeAppLaunchHttpHandler({ service, dashboardOrigin }) {
  return async (request, response, url) => {
    if (url.pathname !== "/api/native-app/launch") return false;
    if (!service) throw httpError(503, "原生 Codex 启动服务尚未就绪");
    if (request.method !== "POST") { sendJson(response, 405, { message: "Method not allowed" }); return true; }
    assertExactMutationOrigin(request, dashboardOrigin); assertJsonContentType(request);
    const body = await readJsonBody(request, 1024);
    if (!body || Object.keys(body).length) throw httpError(400, "启动原生 Codex 不接受额外参数");
    try { sendJson(response, 202, await service.launch()); }
    catch { throw httpError(503, "无法启动原生 Codex，请检查应用是否已安装"); }
    return true;
  };
}
