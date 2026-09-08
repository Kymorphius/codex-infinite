import { sendJson } from "./http-utils.mjs";

export function createDiagnosticsHttpHandler({ diagnosticsService = null } = {}) {
  return async function handleDiagnosticsRequest(request, response, requestUrl) {
    if (requestUrl.pathname !== "/api/diagnostics") return false;
    if (request.method !== "GET" && request.method !== "HEAD") {
      sendJson(response, 405, { status: "error", message: "Method not allowed" });
      return true;
    }
    if (!diagnosticsService) {
      sendJson(response, 503, { status: "error", message: "运行诊断服务不可用" });
      return true;
    }
    sendJson(response, 200, await diagnosticsService.read());
    return true;
  };
}
