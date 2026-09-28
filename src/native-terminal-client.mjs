export function installNativeTerminalClient() {
  if (typeof window.codexControlConsoleTerminal !== 'function') return null;
  window.__cccTerminalNative?.dispose();
  const pending = new Map(), sockets = new Map(); let disposed = false;
  function request(operation, input = {}, timeoutMs = 30000) {
    if (disposed) return Promise.reject(Error('终端连接已关闭'));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(Error('终端操作超时，请核对会话后重试')); }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      try { window.codexControlConsoleTerminal(JSON.stringify({ id, operation, input })); }
      catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
    });
  }
  window.__cccTerminalNativeReceive = message => {
    if (disposed) return;
    if (message.stream) {
      const socket = sockets.get(message.stream); if (!socket) return;
      if (message.close) { socket.readyState = 3; sockets.delete(message.stream); socket.onclose?.(message.close); }
      else if (socket.readyState < 2) { socket.readyState = 1; socket.onmessage?.({ data: JSON.stringify(message.frame) }); }
      return;
    }
    const entry = pending.get(message.id); if (!entry) return;
    pending.delete(message.id); clearTimeout(entry.timer);
    if (message.error) entry.reject(Error(message.error)); else entry.resolve(message.result);
  };
  function socketClass(conversationId) {
    return class NativeSocket {
      constructor() {
        this.readyState = 0; this.stream = crypto.randomUUID(); this.chain = Promise.resolve(); this.bufferedAmount = 0; sockets.set(this.stream, this);
        queueMicrotask(() => request('attach', { id: conversationId, stream: this.stream }).catch(error => this.fail(error)));
      }
      fail(error) { if (this.readyState >= 2) return; this.onerror?.(error); this.close(); this.onclose?.({ code: 4002, reason: error.message }); }
      send(payload) {
        if (this.readyState !== 1) throw Error('终端未连接');
        const frame = JSON.parse(payload), bytes = new TextEncoder().encode(payload).byteLength;
        if (this.bufferedAmount + bytes > 131072) throw Error('终端输入过快，请等待');
        this.bufferedAmount += bytes;
        this.chain = this.chain.then(() => { if (this.readyState === 1) return request('input', { stream: this.stream, frame }); }).catch(error => this.fail(error)).finally(() => { this.bufferedAmount -= bytes; });
      }
      close() {
        if (this.readyState >= 2) return;
        this.readyState = 3; sockets.delete(this.stream); void request('detach', { stream: this.stream }).catch(() => {});
      }
    };
  }
  const api = { request, socketClass, dispose() {
    for (const socket of sockets.values()) socket.close(); disposed = true;
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(Error('终端连接已重建')); } pending.clear();
  } };
  window.__cccTerminalNative = api; return api;
}
