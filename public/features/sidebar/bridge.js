const channel = new URLSearchParams(location.search).get('channel');
const actions = new Set(['sidebar-show', 'section-create', 'section-rename', 'section-delete', 'section-shift', 'item-move', 'item-shift', 'open']);
window.addEventListener('message', async event => {
  if (event.source !== parent || event.origin !== 'app://-' || !/^[0-9a-f-]{36}$/.test(channel || '')) return;
  const message = event.data;
  if (message?.type !== 'codex-sidebar-request' || message.channel !== channel || typeof message.id !== 'string') return;
  if (!['read', 'apply'].includes(message.operation)) return;
  try {
    if (message.operation === 'apply' && !actions.has(message.input?.action)) throw Error('不支持此操作');
    const response = await fetch(message.operation === 'read' ? '/api/sidebar' : '/api/sidebar/actions', message.operation === 'read'
      ? { cache: 'no-store' } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(message.input) });
    const result = await response.json();
    if (!response.ok) throw Error(result.message || '侧边栏服务未就绪');
    parent.postMessage({ type: 'codex-sidebar-response', channel, id: message.id, result }, event.origin);
  } catch (error) {
    parent.postMessage({ type: 'codex-sidebar-response', channel, id: message.id, error: error.message }, event.origin);
  }
});
parent.postMessage({ type: 'codex-sidebar-ready', channel }, 'app://-');
