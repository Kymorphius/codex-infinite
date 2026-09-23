import { assertExactMutationOrigin, assertJsonContentType, readJsonBody, sendJson } from './http-utils.mjs';
import { personalPanelTaskMutation } from './personal-panel-task-contract.mjs';

export function createPersonalPanelTaskHttpHandler({ adapter, dashboardOrigin }) {
  return async (request, response, requestUrl) => {
    if (requestUrl.pathname !== '/api/personal-panel/tasks') return false;
    if (request.method === 'GET' || request.method === 'HEAD') {
      if (!adapter) { sendJson(response, 200, { status: 'unavailable', message: 'Personal Panel 任务桥接尚未配置' }); return true; }
      try { sendJson(response, 200, { status: 'ok', ...(await adapter.list()) }); }
      catch (error) { sendJson(response, 200, { status: 'unavailable', message: error.message || 'Personal Panel 暂时无法读取' }); }
      return true;
    }
    if (request.method !== 'PATCH') { sendJson(response, 405, { status: 'error', message: 'Method not allowed' }); return true; }
    assertExactMutationOrigin(request, dashboardOrigin);
    assertJsonContentType(request);
    if (!adapter) { sendJson(response, 503, { status: 'error', message: 'Personal Panel 任务桥接尚未配置' }); return true; }
    const input = await readJsonBody(request);
    try {
      const fresh = await adapter.list();
      const command = personalPanelTaskMutation(fresh, input);
      await adapter.mutate(command);
      const readback = await adapter.list();
      sendJson(response, 200, { status: 'ok', ...readback });
    } catch (error) { sendJson(response, 409, { status: 'error', message: error.message || '原生任务状态未确认，请刷新核对' }); }
    return true;
  };
}
