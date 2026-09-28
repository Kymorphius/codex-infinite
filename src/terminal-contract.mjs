export const TERMINAL_LIMITS = Object.freeze({ sessions: 8, replayBytes: 1024 * 1024,
  inputBytes: 64 * 1024, frameBytes: 128 * 1024, bufferedBytes: 2 * 1024 * 1024 });

export function terminalError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

export function assertTerminalObject(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some(key => !keys.includes(key))) throw terminalError(400, '终端请求字段无效');
}

export function terminalDimensions(cols = 80, rows = 24) {
  if (!Number.isInteger(cols) || cols < 2 || cols > 500 || !Number.isInteger(rows) || rows < 1 || rows > 300) {
    throw terminalError(400, '终端尺寸无效');
  }
  return { cols, rows };
}

export function terminalCreateInput(input, defaultCwd) {
  assertTerminalObject(input, ['cwd', 'kind', 'cols', 'rows']);
  const cwd = input.cwd ?? defaultCwd, kind = input.kind ?? 'shell';
  if (typeof cwd !== 'string' || !cwd || cwd.length > 4096 || /[\0\r\n]/u.test(cwd)) throw terminalError(400, '工作目录无效');
  if (!['shell', 'claude'].includes(kind)) throw terminalError(400, '终端类型无效');
  return { cwd, kind, ...terminalDimensions(input.cols, input.rows) };
}

export function terminalId(id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/u.test(id)) throw terminalError(400, '终端标识无效');
  return id;
}

export function terminalClientFrame(frame) {
  assertTerminalObject(frame, frame?.type === 'input' ? ['type', 'data'] : frame?.type === 'redraw' ? ['type'] : ['type', 'cols', 'rows']);
  if (frame.type === 'input') {
    if (typeof frame.data !== 'string' || new TextEncoder().encode(frame.data).length > TERMINAL_LIMITS.inputBytes) {
      throw terminalError(400, '终端输入过大或无效');
    }
    return { type: 'input', data: frame.data };
  }
  if (frame.type === 'resize') return { type: 'resize', ...terminalDimensions(frame.cols, frame.rows) };
  if (frame.type === 'redraw') return { type: 'redraw' };
  throw terminalError(400, '不支持的终端消息');
}
