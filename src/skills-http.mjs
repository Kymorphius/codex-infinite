import { assertExactMutationOrigin, assertJsonContentType, httpError, readJsonBody, readRequestBody, sendJson } from "./http-utils.mjs";
import { loadActionKey, NonceReplayWindow, verifyPeerAction } from "./peer-action-auth.mjs";

const OWNER_PATH = "/api/node/actions/skill-install";
const OWNER_TOGGLE_PATH = "/api/node/actions/skill-toggle";
const MAX_PACKAGE_BODY = 3 * 1024 * 1024;

function parseBody(body) {
  try { return JSON.parse(body.toString("utf8") || "{}"); }
  catch { throw httpError(400, "请求 JSON 无效"); }
}

export function createSkillsHttpHandler({ skillSyncService, localSkillAdapter, dashboardOrigin, nodeActionKeyPath, replayWindow = new NonceReplayWindow() } = {}) {
  return async function handleSkillsRequest(request, response, requestUrl) {
    const nodeCatalog = requestUrl.pathname === "/api/node/skills";
    const nodeContent = requestUrl.pathname === "/api/node/skills/content";
    const browserCatalog = requestUrl.pathname === "/api/skills";
    const browserSync = requestUrl.pathname === "/api/skills/sync";
    const browserToggle = requestUrl.pathname === "/api/skills/toggle";
    const ownerInstall = requestUrl.pathname === OWNER_PATH;
    const ownerToggle = requestUrl.pathname === OWNER_TOGGLE_PATH;
    if (!nodeCatalog && !nodeContent && !browserCatalog && !browserSync && !browserToggle && !ownerInstall && !ownerToggle) return false;

    if ((nodeCatalog || nodeContent || browserCatalog) && !["GET", "HEAD"].includes(request.method)) {
      sendJson(response, 405, { status: "error", message: "Method not allowed" });
      return true;
    }
    if (nodeCatalog) {
      const catalog = await localSkillAdapter.list();
      sendJson(response, 200, { schemaVersion: 2, skills: catalog.skills });
      return true;
    }
    if (nodeContent) {
      sendJson(response, 200, await localSkillAdapter.export(requestUrl.searchParams.get("scope"), requestUrl.searchParams.get("name"), requestUrl.searchParams.get("sourceId") || requestUrl.searchParams.get("scope")));
      return true;
    }
    if (browserCatalog) {
      sendJson(response, 200, await skillSyncService.catalog());
      return true;
    }
    if (browserSync) {
      if (request.method !== "POST") {
        sendJson(response, 405, { status: "error", message: "Method not allowed" });
        return true;
      }
      assertExactMutationOrigin(request, dashboardOrigin);
      assertJsonContentType(request);
      const result = await skillSyncService.sync(await readJsonBody(request, 32 * 1024));
      sendJson(response, result.converged ? 200 : 207, { status: "ok", ...result });
      return true;
    }
    if (browserToggle) {
      if (request.method !== "POST") {
        sendJson(response, 405, { status: "error", message: "Method not allowed" });
        return true;
      }
      assertExactMutationOrigin(request, dashboardOrigin);
      assertJsonContentType(request);
      sendJson(response, 200, { status: "ok", ...await skillSyncService.toggle(await readJsonBody(request, 32 * 1024)) });
      return true;
    }
    if (request.method !== "POST") {
      sendJson(response, 405, { status: "error", message: "Method not allowed" });
      return true;
    }
    assertJsonContentType(request);
    const body = await readRequestBody(request, MAX_PACKAGE_BODY);
    const key = await loadActionKey(nodeActionKeyPath);
    const verification = verifyPeerAction({ key, method: request.method, path: requestUrl.pathname, headers: request.headers, body, replayWindow });
    if (!verification.ok) throw httpError(401, "节点操作认证失败");
    if (verification.duplicate) {
      sendJson(response, 202, { status: "ok", accepted: true, duplicate: true });
      return true;
    }
    const result = ownerInstall
      ? await localSkillAdapter.install(parseBody(body))
      : await localSkillAdapter.setEnabled(parseBody(body));
    sendJson(response, 202, { status: "ok", ...result, accepted: true });
    return true;
  };
}
