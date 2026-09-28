import { assertJsonContentType, readJsonBody, sendJson, httpError } from './http-utils.mjs';
import { assertTerminalOrigin } from './terminal-http.mjs';
import { assertTerminalObject } from './terminal-contract.mjs';
import { terminalConversationId, terminalStartInput } from './terminal-conversation-contract.mjs';

export function createTerminalConversationHttpHandler({ service, dashboardOrigin } = {}) {
  const prefix = '/api/terminal-conversations/';
  const actions = new Set(['list', 'open', 'create', 'start', 'update', 'stop']);
  return async (request, response, url) => {
    if (!url.pathname.startsWith(prefix) || !actions.has(url.pathname.slice(prefix.length))) return false;
    if (request.method !== 'POST') throw httpError(405, 'Method not allowed');
    assertTerminalOrigin(request, dashboardOrigin); assertJsonContentType(request);
    if (!service) throw httpError(503, '终端会话服务不可用');
    const input = await readJsonBody(request, 8192), action = url.pathname.slice(prefix.length);
    if (action === 'list') { assertTerminalObject(input, []); sendJson(response, 200, await service.list()); }
    else if (action === 'create' || action === 'update') sendJson(response, 200, { conversation: await service[action](input) });
    else if (action === 'start') sendJson(response, 200, { conversation: await service.start(terminalStartInput(input)) });
    else {
      assertTerminalObject(input, ['id']);
      sendJson(response, 200, { conversation: await service[action]({ id: terminalConversationId(input.id) }) });
    }
    return true;
  };
}
