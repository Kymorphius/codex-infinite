import { readNativeTerminalChanges } from './native-terminal-changes.mjs';
import { assertTerminalObject, TERMINAL_LIMITS } from './terminal-contract.mjs';
import { terminalConversationId, terminalStartInput, terminalCompanionCreateInput } from './terminal-conversation-contract.mjs';
export const NATIVE_TERMINAL_BINDING = 'codexControlConsoleTerminal';
const FLUSH_BYTES = 256 * 1024;

export async function installNativeTerminalBinding(connection, conversations, terminals) {
  const streams = new Map(), queues = new Map(), actions = new Map(), origins = new Map(); let disposed = false;
  const drop = key => { streams.get(key)?.detach(); streams.delete(key); };
  // Messages to one page context go out in order. While an evaluate is in flight, later
  // messages queue and the next evaluate carries all of them (up to FLUSH_BYTES), so a
  // full-screen redraw costs a few evaluates instead of one per output chunk.
  function deliver(contextId, message) {
    if (disposed) return Promise.resolve();
    const payload = JSON.stringify(message), bytes = Buffer.byteLength(payload);
    let queue = queues.get(contextId);
    if (!queue) queues.set(contextId, queue = { bytes: 0, pending: [], running: false, idle: Promise.resolve(), settle: null });
    if (queue.bytes + bytes > TERMINAL_LIMITS.bufferedBytes) return Promise.reject(Error('终端输出过快'));
    queue.bytes += bytes;
    const done = new Promise((resolve, reject) => queue.pending.push({ payload, bytes, resolve, reject }));
    if (!queue.running) void flush(contextId, queue);
    return done;
  }
  async function flush(contextId, queue) {
    queue.running = true; queue.idle = new Promise(resolve => { queue.settle = resolve; });
    while (queue.pending.length) {
      const batch = [queue.pending.shift()]; let size = batch[0].bytes;
      while (queue.pending.length && size + queue.pending[0].bytes <= FLUSH_BYTES) { const item = queue.pending.shift(); batch.push(item); size += item.bytes; }
      const expression = batch.length === 1 ? `globalThis.__cccTerminalNativeReceive?.(${batch[0].payload})`
        : `(() => { const receive = globalThis.__cccTerminalNativeReceive; if (!receive) return; for (const message of [${batch.map(item => item.payload).join(',')}]) { try { receive(message); } catch {} } })()`;
      try {
        if (disposed) throw Error('终端连接已关闭');
        const result = await connection.send('Runtime.evaluate', { expression, contextId, returnByValue: true });
        for (const item of batch) item.resolve(result);
      } catch (error) { for (const item of batch) item.reject(error); }
      finally { queue.bytes -= size; }
    }
    queue.running = false; queue.settle();
  }
  // The page origin is checked once per execution context; a navigation creates a new one.
  async function trusted(contextId) {
    if (origins.get(contextId) === true) return true;
    const allowed = await connection.send('Runtime.evaluate', {
      expression: "location.origin === 'app://-' && window === window.top", contextId, returnByValue: true
    });
    const ok = allowed?.result?.value === true;
    if (ok) origins.set(contextId, true);
    return ok;
  }
  async function handle(params) {
    const contextId = params.executionContextId;
    let message;
    try {
      if (!Number.isInteger(contextId) || typeof params.payload !== 'string' || Buffer.byteLength(params.payload) > TERMINAL_LIMITS.frameBytes) return;
      message = JSON.parse(params.payload); assertTerminalObject(message, ['id', 'operation', 'input']);
      if (!/^[\w-]{1,80}$/u.test(message.id || '')) return;
      if (!(await trusted(contextId)) || disposed) return;
      const { operation, input = {} } = message; let result;
      if (operation === 'list') { assertTerminalObject(input, []); result = await conversations.list(); }
      else if (operation === 'changes-list' || operation === 'changes-file') {
        assertTerminalObject(input, operation === 'changes-file' ? ['id', 'file'] : ['id']);
        const record = await conversations.open({ id: terminalConversationId(input.id) });
        if (record.kind !== 'claude' || typeof record.cwd !== 'string') throw Error('只支持本地 Claude 会话的变更预览');
        result = await readNativeTerminalChanges(record.cwd, operation === 'changes-file' ? input.file : null);
      }
      else if (['create', 'update'].includes(operation)) result = { conversation: await conversations[operation](input) };
      else if (operation === 'start') result = { conversation: await conversations.start(terminalStartInput(input)) };
      else if (operation === 'create-companion') result = { conversation: await conversations.createCompanion(terminalCompanionCreateInput(input)) };
      else if (['open', 'stop'].includes(operation)) {
        assertTerminalObject(input, ['id']); result = { conversation: await conversations[operation]({ id: terminalConversationId(input.id) }) };
      } else if (operation === 'attach') {
        assertTerminalObject(input, ['id', 'stream']); terminalConversationId(input.stream);
        const record = await conversations.open({ id: terminalConversationId(input.id) });
        if (!record.runtimeSessionId || record.archived) throw Error('会话未运行，请先启动');
        const key = `${contextId}:${input.stream}`;
        if (streams.has(key) || streams.size >= 8) throw Error('终端连接数量已达上限');
        const transport = terminals.connect(record.runtimeSessionId, {
          send: frame => { void deliver(contextId, { stream: input.stream, frame }).catch(async () => {
            drop(key); await queues.get(contextId)?.idle;
            await deliver(contextId, { stream: input.stream, close: { code: 4002, reason: '终端输出过快，请重新连接' } }).catch(() => {});
          }); },
          close: (code, reason) => { drop(key); void deliver(contextId, { stream: input.stream, close: { code, reason } }).catch(() => {}); }
        });
        if (disposed) transport.detach(); else streams.set(key, transport);
        result = { ok: true };
      } else if (operation === 'input' || operation === 'detach') {
        assertTerminalObject(input, operation === 'input' ? ['stream', 'frame'] : ['stream']); terminalConversationId(input.stream);
        const key = `${contextId}:${input.stream}`, stream = streams.get(key);
        if (!stream) throw Error('终端连接已断开');
        if (operation === 'input') stream.receive(input.frame); else drop(key);
        result = { ok: true };
      } else throw Error('不支持的终端操作');
      await deliver(contextId, { id: message.id, result });
    } catch (error) {
      if (message?.id && Number.isInteger(contextId)) await deliver(contextId, { id: message.id, error: error.message || '终端操作失败' }).catch(() => {});
    }
  }
  const remove = connection.onEvent(event => {
    if (event.method === 'Runtime.bindingCalled' && event.params?.name === NATIVE_TERMINAL_BINDING) {
      const id = event.params.executionContextId, queue = actions.get(id) || { count: 0, chain: Promise.resolve() };
      if (queue.count >= 128) return;
      queue.count++; actions.set(id, queue);
      queue.chain = queue.chain.then(() => disposed ? undefined : handle(event.params)).catch(() => {}).finally(() => { queue.count--; });
    }
    if (event.method === 'Runtime.executionContextDestroyed') {
      origins.delete(event.params.executionContextId);
      const prefix = `${event.params.executionContextId}:`;
      for (const key of streams.keys()) if (key.startsWith(prefix)) drop(key);
    }
    if (event.method === 'Runtime.executionContextsCleared') { origins.clear(); for (const key of streams.keys()) drop(key); }
  });
  await connection.send('Runtime.enable');
  await connection.send('Runtime.addBinding', { name: NATIVE_TERMINAL_BINDING });
  return () => { disposed = true; remove(); for (const key of streams.keys()) drop(key); queues.clear(); };
}
