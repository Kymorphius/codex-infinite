// Keep the bounded native transport independent of held/assigned UI state.
export function createNativeHeldQueueRequest() {
  let sequence = 0;
  return function request(method, params) {
    const allowed = new Set(['thread/queue/list','thread/queue/delete','thread/queue/add','thread/queue/reorder']);
    if (!allowed.has(method)) return Promise.reject(new Error('队列操作无效'));
    const bridge = window.electronBridge?.sendMessageFromView;
    if (typeof bridge !== 'function') return Promise.reject(new Error('原生队列桥接尚未就绪'));
    const id = 'ccc-held-queue-' + Date.now() + '-' + (++sequence);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error('原生队列请求超时')); }, 8000);
      const receive = (event) => {
        const data = event.data;
        if (data?.type !== 'mcp-response' || data?.hostId !== 'local' || data?.message?.id !== id) return;
        cleanup();
        if (data.message.error) reject(new Error(data.message.error.message || '原生队列请求失败'));
        else resolve(data.message.result);
      };
      const cleanup = () => { clearTimeout(timer); window.removeEventListener('message', receive); };
      window.addEventListener('message', receive);
      Promise.resolve(bridge.call(window.electronBridge, { type: 'mcp-request', hostId: 'local', retainResponse: true, request: { id, method, params } })).catch((error) => { cleanup(); reject(error); });
    });
  };
}
