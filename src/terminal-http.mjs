import { assertExactMutationOrigin, assertJsonContentType, readJsonBody, sendJson, httpError } from './http-utils.mjs';
import { assertTerminalObject, terminalId } from './terminal-contract.mjs';

export function assertTerminalOrigin(request, dashboardOrigin) {
  assertExactMutationOrigin(request, dashboardOrigin);
  if (request.headers.host !== new URL(dashboardOrigin).host) throw httpError(403, '终端请求主机无效');
}

export function createTerminalHttpHandler({ service, dashboardOrigin } = {}) {
  const paths = new Set(['/api/terminal/list', '/api/terminal/create', '/api/terminal/close']);
  return async (request, response, url) => {
    if (!paths.has(url.pathname)) return false;
    if (request.method !== 'POST') throw httpError(405, 'Method not allowed');
    assertTerminalOrigin(request, dashboardOrigin);
    assertJsonContentType(request);
    if (!service) throw httpError(503, '终端服务不可用');
    const input = await readJsonBody(request, 8192);
    if (url.pathname.endsWith('/list')) {
      assertTerminalObject(input, []); sendJson(response, 200, service.list());
    } else if (url.pathname.endsWith('/create')) sendJson(response, 200, { session: await service.create(input) });
    else {
      assertTerminalObject(input, ['id']); sendJson(response, 200, await service.close(terminalId(input.id)));
    }
    return true;
  };
}
