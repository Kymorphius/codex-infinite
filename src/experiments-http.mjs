import { sendJson } from './http-utils.mjs';
export function createExperimentsHttpHandler({ experimentService } = {}) {
  return async (request, response, url) => {
    if (!['/api/experiments', '/api/node/experiments'].includes(url.pathname)) return false;
    if (!['GET', 'HEAD'].includes(request.method)) {
      sendJson(response, 405, { status: 'error', message: 'Method not allowed' });
    } else if (!experimentService) {
      sendJson(response, 503, { status: 'error', message: '实验功能读取服务不可用' });
    } else {
      sendJson(response, 200, await (url.pathname === '/api/node/experiments' ? experimentService.readLocal() : experimentService.read()));
    }
    return true;
  };
}
