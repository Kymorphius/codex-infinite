import { requestJson } from '../../core/transport.js';

export function installTerminalBridge({ windowRef = window, request = requestJson } = {}) {
  const channel = new URL(windowRef.location.href).searchParams.get('channel');
  if (!/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/iu.test(channel || '') || windowRef.parent === windowRef) return false;
  const operations = new Set(['list', 'create', 'open', 'update', 'start', 'stop', 'create-companion']);
  const reply = value => windowRef.parent.postMessage({ ...value, channel }, 'app://-');
  windowRef.addEventListener('message', async event => {
    const message = event.data;
    if (event.source !== windowRef.parent || event.origin !== 'app://-' || message?.type !== 'codex-terminal-request'
      || message.channel !== channel || typeof message.id !== 'string' || message.id.length > 100) return;
    if (!operations.has(message.operation)) return reply({ type: 'codex-terminal-response', id: message.id, error: '不支持的会话操作。' });
    try {
      const result = await request(`/api/terminal-conversations/${message.operation}`, { method: 'POST', body: message.input || {} });
      reply({ type: 'codex-terminal-response', id: message.id, result });
    } catch (error) { reply({ type: 'codex-terminal-response', id: message.id, error: error.message || '会话操作未完成。' }); }
  });
  reply({ type: 'codex-terminal-ready' });
  return true;
}

if (typeof window !== 'undefined') installTerminalBridge();
