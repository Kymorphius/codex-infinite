import { assertExactMutationOrigin, assertJsonContentType, readJsonBody, readRequestBody, sendJson, httpError } from './http-utils.mjs';
import { ACTION_HEADERS, loadActionKey, NonceReplayWindow, verifyPeerAction } from './peer-action-auth.mjs';

export function createSidebarHttpHandler({ sidebarService, nativeSidebarAdapter, dashboardOrigin, nodeActionKeyPath,
  replayWindow = new NonceReplayWindow(), now = Date.now } = {}) {
  const receipts = new Map();
  return async (request, response, url) => {
    if (!['/api/sidebar', '/api/node/sidebar', '/api/sidebar/actions', '/api/node/actions/sidebar'].includes(url.pathname)) return false;
    const owner = url.pathname.includes('/node/'), mutation = url.pathname.includes('/actions');
    if (mutation ? request.method !== 'POST' : !['GET', 'HEAD'].includes(request.method)) throw httpError(405, 'Method not allowed');
    const service = owner ? nativeSidebarAdapter : sidebarService;
    if (!service) throw httpError(503, '原生侧边栏服务尚未就绪');
    if (!mutation) { sendJson(response, 200, await service.read()); return true; }
    assertJsonContentType(request);
    if (!owner) {
      assertExactMutationOrigin(request, dashboardOrigin);
      sendJson(response, 200, { status: 'ok', ...await service.apply(await readJsonBody(request, 8192)) }); return true;
    }
    const body = await readRequestBody(request, 8192), key = await loadActionKey(nodeActionKeyPath);
    const verified = verifyPeerAction({ key, method: request.method, path: url.pathname, headers: request.headers, body, replayWindow, now: now() });
    if (!verified.ok) throw httpError(401, '节点操作认证失败');
    for (const [id, receipt] of receipts) if (receipt.until <= now()) receipts.delete(id);
    // Signature binds method, path, nonce and exact payload. A retry gets the same completed or pending receipt.
    const id = request.headers[ACTION_HEADERS.signature];
    if (verified.duplicate && !receipts.has(id)) throw httpError(409, '操作回执已失效，请刷新核对');
    if (!receipts.has(id)) {
      if (receipts.size >= 256) throw httpError(429, '侧边栏操作过于频繁');
      let input; try { input = JSON.parse(body.toString('utf8')); } catch { throw httpError(400, '请求 JSON 无效'); }
      const result = Promise.resolve().then(() => service.apply(input))
        .then(value => ({ code: 200, body: { status: 'ok', ...value } }))
        .catch(error => ({ code: error.statusCode || 409, body: { status: 'error', message: error.statusCode ? error.message : '原生侧边栏修改未确认，请刷新核对' } }));
      receipts.set(id, { until: now() + 60000, result });
    }
    const receipt = await receipts.get(id).result;
    sendJson(response, receipt.code, receipt.body); return true;
  };
}
