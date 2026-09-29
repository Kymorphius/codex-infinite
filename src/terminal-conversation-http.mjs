import { assertJsonContentType, readJsonBody, sendJson, httpError } from './http-utils.mjs';
import { assertTerminalOrigin } from './terminal-http.mjs';
import { assertTerminalObject } from './terminal-contract.mjs';
import { terminalConversationId, terminalStartInput, terminalCompanionCreateInput, terminalMirrorInput, terminalMirrorSendInput } from './terminal-conversation-contract.mjs';

export function createTerminalConversationHttpHandler({ service, dashboardOrigin } = {}) {
  const prefix = '/api/terminal-conversations/';
  const actions = new Set(['list', 'open', 'create', 'start', 'update', 'stop', 'create-companion', 'mirror', 'mirror-send']);
  return async (request, response, url) => {
    if (!url.pathname.startsWith(prefix) || !actions.has(url.pathname.slice(prefix.length))) return false;
    if (request.method !== 'POST') throw httpError(405, 'Method not allowed');
    assertTerminalOrigin(request, dashboardOrigin); assertJsonContentType(request);
    if (!service) throw httpError(503, '终端会话服务不可用');
    const action = url.pathname.slice(prefix.length), input = await readJsonBody(request, action === 'mirror-send' ? 96 * 1024 : 8192);
    if (action === 'list') { assertTerminalObject(input, []); sendJson(response, 200, await service.list()); }
    else if (action === 'create' || action === 'update') sendJson(response, 200, { conversation: await service[action](input) });
    else if (action === 'start') sendJson(response, 200, { conversation: await service.start(terminalStartInput(input)) });
    else if (action === 'mirror') sendJson(response, 200, await service.mirror(terminalMirrorInput(input)));
    else if (action === 'mirror-send') sendJson(response, 202, await service.mirrorSend(terminalMirrorSendInput(input)));
    else if (action === 'create-companion') sendJson(response, 200, { conversation: await service.createCompanion(terminalCompanionCreateInput(input)) });
    else {
      assertTerminalObject(input, ['id']);
      sendJson(response, 200, { conversation: await service[action]({ id: terminalConversationId(input.id) }) });
    }
    return true;
  };
}
