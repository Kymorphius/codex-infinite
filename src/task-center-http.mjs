import { assertExactMutationOrigin, assertJsonContentType, readJsonBody, readRequestBody, sendJson, httpError } from './http-utils.mjs';
import { ACTION_HEADERS, loadActionKey, NonceReplayWindow, verifyPeerAction } from './peer-action-auth.mjs';

export function createTaskCenterHttpHandler({ service, owner, images, dashboardOrigin, nodeActionKeyPath,
  replayWindow = new NonceReplayWindow(), now = Date.now } = {}) {
  const paths = new Set(['/api/task-center', '/api/node/task-center', '/api/task-center/actions', '/api/node/actions/task-center', '/api/node/actions/task-images']);
  const receipts = new Map();
  return async (request, response, url) => {
    if (!paths.has(url.pathname)) return false;
    const native = url.pathname.includes('/node/'), mutation = url.pathname.includes('/actions');
    if (mutation ? request.method !== 'POST' : !['GET', 'HEAD'].includes(request.method)) throw httpError(405, 'Method not allowed');
    if (!service || !owner) throw httpError(503, '统一任务服务尚未就绪');
    if (!mutation) {
      const refresh = url.searchParams.get('refresh') === '1';
      sendJson(response, 200, await (native ? owner.read() : service.read({ force: refresh, wait: refresh }))); return true;
    }
    assertJsonContentType(request);
    if (!native) {
      assertExactMutationOrigin(request, dashboardOrigin);
      sendJson(response, 200, { status: 'ok', ...await service.apply(await readJsonBody(request, 65536)) }); return true;
    }
    const body = await readRequestBody(request, 65536), key = await loadActionKey(nodeActionKeyPath);
    const verified = verifyPeerAction({ key, method: request.method, path: url.pathname, headers: request.headers, body, replayWindow, now: now() });
    if (!verified.ok) throw httpError(401, '节点操作认证失败');
    if (url.pathname.endsWith('/task-images')) {
      let input; try { input = JSON.parse(body.toString('utf8')); } catch { throw httpError(400, '请求 JSON 无效'); }
      // Read-only exports can be repeated; do not retain large image bodies in mutation receipts.
      sendJson(response, 200, { status: 'ok', ...await images.exportBundle(input) }); return true;
    }
    const id = request.headers[ACTION_HEADERS.signature];
    for (const [token, receipt] of receipts) if (receipt.until <= now() && !receipt.pending) receipts.delete(token);
    if (verified.duplicate && !receipts.has(id)) throw httpError(409, '回执已过期，请刷新核对');
    if (!receipts.has(id)) {
      if (receipts.size >= 256) throw httpError(429, '任务操作过于频繁');
      let input; try { input = JSON.parse(body.toString('utf8')); } catch { throw httpError(400, '请求 JSON 无效'); }
      const receipt = { pending: true, until: now() + 60000 };
      receipt.result = Promise.resolve().then(() => owner.apply(input))
        .then(result => ({ code: 200, body: { status: 'ok', ...result } }))
        .catch(error => ({ code: error.statusCode || 409, body: { status: 'error', code: error.statusCode ? error.code : 'UNCONFIRMED', message: error.statusCode ? error.message : '来源设备未确认任务操作，请刷新核对' } }))
        .finally(() => { receipt.pending = false; receipt.until = now() + 60000; });
      receipts.set(id, receipt);
    }
    const result = await receipts.get(id).result;
    sendJson(response, result.code, result.body); return true;
  };
}
