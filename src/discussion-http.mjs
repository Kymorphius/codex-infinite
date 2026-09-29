import { assertJsonContentType, readJsonBody, sendJson, httpError } from './http-utils.mjs';
import { assertTerminalOrigin } from './terminal-http.mjs';
import { discussionActions } from './discussion-actions.mjs';

// Exact-origin POST-only transport; every action is a bounded JSON body. No path parameters,
// so ids are always validated by the contract.
export function createDiscussionHttpHandler({ service, dashboardOrigin } = {}) {
  const prefix = '/api/discussions/';
  const actions = discussionActions(service);
  return async (request, response, url) => {
    if (!url.pathname.startsWith(prefix) || !Object.hasOwn(actions, url.pathname.slice(prefix.length))) return false;
    if (request.method !== 'POST') throw httpError(405, 'Method not allowed');
    assertTerminalOrigin(request, dashboardOrigin); assertJsonContentType(request);
    if (!service) throw httpError(503, '讨论服务不可用');
    sendJson(response, 200, await actions[url.pathname.slice(prefix.length)](await readJsonBody(request, 16 * 1024)));
    return true;
  };
}
