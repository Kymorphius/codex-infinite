import { sendJson } from "./http-utils.mjs";

export function createHealthHttpHandler(config) {
  return function handleHealthRequest(response, requestUrl) {
    if (requestUrl.pathname !== "/api/health") return false;
    sendJson(response, 200, {
      status: "ok",
      dashboardOrigin: config.dashboardOrigin,
      cdpOrigin: config.cdpOrigin,
      profileDirectory: config.profileDirectory,
      perThreadExtendedContextWindow: config.perThreadContextWindow || null,
      regularChatContextMode: "model-default",
      regularChatExtendedContext: false,
      taskAdapter: "federated-codex-nodes"
    });
    return true;
  };
}
