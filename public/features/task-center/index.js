import { createTaskCenterController } from './controller.js';
import { createTaskCenterView } from './view.js';

export function createTaskCenter({ $, state, requestOpen, formatDate, fetchImpl = fetch, documentRef = document }) {
  const root = $('[data-task-center]');
  let view;
  async function request(path, { method = 'GET', body } = {}) {
    const aborter = new AbortController();
    const timer = setTimeout(() => aborter.abort(), method === 'GET' ? 30000 : 60000);
    try {
      const response = await fetchImpl(path, { method, cache: 'no-store', signal: aborter.signal,
        ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
      const data = await response.json();
      if (!response.ok) throw Error(data.message || `HTTP ${response.status}`);
      return data;
    } catch (error) { throw error.name === 'AbortError' ? Error('请求超时，结果尚未确认。') : error; }
    finally { clearTimeout(timer); }
  }
  const controller = createTaskCenterController({ request, tasks: () => state.tasks || [], render: model => view?.render(model) });
  view = createTaskCenterView({ root, documentRef, controller, requestOpen, tasks: () => state.tasks || [], formatDate });
  return { ...controller, bind: view.bind };
}
