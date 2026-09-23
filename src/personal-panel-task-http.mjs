import { assertExactMutationOrigin, assertJsonContentType, readJsonBody, sendJson } from './http-utils.mjs';
import { personalPanelTaskMutation } from './personal-panel-task-contract.mjs';

export function createPersonalPanelTaskHttpHandler({ adapter, localAdapter, localDevice, dashboardOrigin }) {
  return async (request, response, requestUrl) => {
    const isTasks = requestUrl.pathname === '/api/personal-panel/tasks';
    const isLinks = requestUrl.pathname === '/api/personal-panel/links';
    if (!isTasks && !isLinks) return false;
    if (isLinks) {
      if (!adapter) { sendJson(response, 503, { status: 'unavailable', message: 'Personal Panel 任务桥接尚未配置' }); return true; }
      if (request.method === 'GET' || request.method === 'HEAD') {
        try {
          const schema = await adapter.inspectLinks();
          const id = requestUrl.searchParams.get('id');
          if (!id) { sendJson(response, 200, { status: 'ok', ...schema }); return true; }
          const owner = { accountId: requestUrl.searchParams.get('accountId'), spaceId: requestUrl.searchParams.get('spaceId') };
          const links = schema.schema?.ready ? await adapter.listLinks(owner, id) : null;
          sendJson(response, 200, { status: 'ok', ...schema, task: links });
        } catch (error) { sendJson(response, 200, { status: 'unavailable', message: error.message || '原生关联暂时不可读' }); }
        return true;
      }
      if (request.method !== 'POST') { sendJson(response, 405, { status: 'error', message: 'Method not allowed' }); return true; }
      assertExactMutationOrigin(request, dashboardOrigin);
      assertJsonContentType(request);
      const input = await readJsonBody(request);
      try {
        const schema = await adapter.inspectLinks();
        if (input?.owner?.accountId !== schema.owner?.accountId || input?.owner?.spaceId !== schema.owner?.spaceId) throw new Error('原生账户或空间已变化，请刷新核对');
        if (input.action === 'initialize') {
          if (input.confirmed !== true) throw new Error('请明确确认初始化原生关联属性');
          await adapter.mutate({ op: 'task.links.initialize', owner: schema.owner, confirmed: true });
          const readback = await adapter.inspectLinks();
          if (!readback.schema?.ready) throw new Error('原生属性初始化结果待核对，请勿直接重试');
          sendJson(response, 200, { status: 'ok', ...readback });
          return true;
        }
        if (!['link', 'unlink'].includes(input.action) || !schema.schema?.ready) throw new Error('原生会话关联尚未就绪');
        if (input.confirmed !== true || typeof input.id !== 'string' || typeof input.sessionId !== 'string' || typeof input.revision !== 'string') throw new Error('需要明确确认任务、会话与当前版本');
        if (input.deviceId !== localDevice?.id) throw new Error('这里只能关联本机已确认的 Codex 会话');
        const current = await adapter.listLinks(schema.owner, input.id);
        if (current.readOnly || current.revision !== input.revision) throw new Error('原生任务已变化，请刷新核对');
        const thread = input.action === 'link' ? await localAdapter?.getTask?.(input.sessionId) : null;
        if (input.action === 'link' && (!thread || thread.id !== input.sessionId || thread.device?.id !== localDevice.id)) throw new Error('目标 Codex 会话不存在或来源已变化');
        if (input.action === 'unlink' && !current.links?.some(link => link.deviceId === localDevice.id && link.sessionId === input.sessionId)) throw new Error('这条原生关联已变化，请刷新核对');
        await adapter.mutate({ op: input.action === 'link' ? 'task.linkExecution' : 'task.unlinkExecution', owner: schema.owner, id: input.id, revision: current.revision, confirmed: true, deviceId: localDevice.id, sessionId: input.sessionId });
        const readback = await adapter.listLinks(schema.owner, input.id);
        const found = readback.links?.some(link => link.deviceId === localDevice.id && link.sessionId === input.sessionId);
        if (found !== (input.action === 'link')) throw new Error('关联写入结果待核对，请勿直接重试');
        sendJson(response, 200, { status: 'ok', owner: schema.owner, task: readback });
      } catch (error) { sendJson(response, 409, { status: 'error', message: error.message || '原生关联未确认，请刷新核对' }); }
      return true;
    }
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
