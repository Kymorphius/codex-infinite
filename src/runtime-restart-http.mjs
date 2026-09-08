import { assertExactMutationOrigin, assertJsonContentType, readJsonBody, sendJson, httpError } from './http-utils.mjs';
export function createRuntimeRestartHttpHandler({ service, dashboardOrigin }) {
  return async (request, response, url) => {
    if (!['/api/runtime/status', '/api/runtime/restart'].includes(url.pathname)) return false;
    if (!service) throw httpError(503, '重启服务尚未就绪');
    if (url.pathname.endsWith('/status') && request.method === 'GET') { sendJson(response, 200, service.status()); return true; }
    if (url.pathname.endsWith('/status') || request.method !== 'POST') { sendJson(response, 405, { message: 'Method not allowed' }); return true; }
    assertExactMutationOrigin(request, dashboardOrigin); assertJsonContentType(request);
    const body = await readJsonBody(request, 1024);
    if (!body || body.confirm !== true || Object.keys(body).some(key => key !== 'confirm')) throw httpError(400, '请确认重启当前设备的控制台');
    try { sendJson(response, 202, await service.request()); }
    catch { throw httpError(503, '无法安排重启，请检查控制台后台服务是否已安装'); }
    return true;
  };
}
