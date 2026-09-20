import { assertExactMutationOrigin, assertJsonContentType, readJsonBody, sendJson } from "./http-utils.mjs";

export function createJevRoutingHttpHandler({ service, dashboardOrigin }) {
  return async function handleJevRouting(request, response, requestUrl) {
    const collection = requestUrl.pathname === "/api/jev-routing";
    const dispatch = requestUrl.pathname === "/api/jev-routing/dispatch";
    if (!collection && !dispatch) return false;
    if (!service) { sendJson(response, 503, { status: "error", message: "自动分流服务不可用" }); return true; }
    if (collection && ["GET", "HEAD"].includes(request.method)) {
      sendJson(response, 200, { status: "ok", ...await service.snapshot() });
      return true;
    }
    if ((collection && request.method === "PUT") || (dispatch && request.method === "POST")) {
      assertExactMutationOrigin(request, dashboardOrigin);
      assertJsonContentType(request);
      const input = await readJsonBody(request, 160 * 1024);
      if (collection) {
        const config = await service.update(input);
        sendJson(response, 200, { status: "ok", config, transport: (await service.snapshot()).transport });
      }
      else sendJson(response, 201, { status: "ok", result: await service.dispatch(input) });
      return true;
    }
    sendJson(response, 405, { status: "error", message: "Method not allowed" });
    return true;
  };
}
