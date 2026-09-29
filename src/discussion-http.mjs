import { assertJsonContentType, readJsonBody, sendJson, httpError } from './http-utils.mjs';
import { assertTerminalOrigin } from './terminal-http.mjs';
import { discussionCreateInput, discussionForwardInput, discussionCommentInput, discussionId, discussionRole } from './discussion-contract.mjs';

const own = (input, keys) => {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !keys.includes(key))) throw httpError(400, '请求内容无效');
  return input;
};

// Exact-origin POST-only transport; every action is a bounded JSON body. No path parameters,
// so ids are always validated by the contract.
export function createDiscussionHttpHandler({ service, dashboardOrigin } = {}) {
  const prefix = '/api/discussions/';
  const actions = {
    list: async input => { own(input, []); return service.list(); },
    get: async input => service.get({ id: discussionId(own(input, ['id']).id) }),
    'for-conversation': async input => service.forConversation({ conversationId: own(input, ['conversationId']).conversationId }),
    create: async input => service.create(discussionCreateInput(input)),
    latest: async input => { own(input, ['id', 'from']); return service.latest({ id: discussionId(input.id), from: discussionRole(input.from) }); },
    comment: async input => service.comment(discussionCommentInput(input)),
    forward: async input => service.forward(discussionForwardInput(input)),
    stop: async input => service.stop({ id: discussionId(own(input, ['id']).id) }),
  };
  return async (request, response, url) => {
    if (!url.pathname.startsWith(prefix) || !Object.hasOwn(actions, url.pathname.slice(prefix.length))) return false;
    if (request.method !== 'POST') throw httpError(405, 'Method not allowed');
    assertTerminalOrigin(request, dashboardOrigin); assertJsonContentType(request);
    if (!service) throw httpError(503, '讨论服务不可用');
    sendJson(response, 200, await actions[url.pathname.slice(prefix.length)](await readJsonBody(request, 16 * 1024)));
    return true;
  };
}
