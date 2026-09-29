import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { TERMINAL_LIMITS, terminalCreateInput, terminalClientFrame, terminalId, terminalError } from './terminal-contract.mjs';
import { spawnTerminalProcess, validateTerminalCwd } from './terminal-process.mjs';
import { cleanTerminalInputLine, terminalInputLine, terminalInputLineView } from './terminal-input-line.mjs';

function summary(entry) {
  const { id, title, cwd, kind, status, cols, rows, exitCode, replayTruncated } = entry;
  return { id, title, cwd, kind, status, cols, rows, exitCode, replayTruncated };
}

function readyFrame(entry) {
  let frame = { type: 'ready', session: summary(entry), replay: entry.replay.toString('utf8') };
  // Escaped control bytes can expand sixfold in JSON. Keep replay reconnectable.
  while (Buffer.byteLength(JSON.stringify(frame)) > TERMINAL_LIMITS.bufferedBytes) {
    let offset = Math.ceil(entry.replay.length / 2);
    while (offset < entry.replay.length && (entry.replay[offset] & 0xc0) === 0x80) offset++;
    entry.replay = entry.replay.subarray(offset); entry.replayTruncated = true;
    frame = { type: 'ready', session: summary(entry), replay: entry.replay.toString('utf8') };
  }
  return frame;
}

export class TerminalService {
  constructor({ userHome = os.homedir(), defaultCwd = userHome, spawnProcess = spawnTerminalProcess,
    validateCwd = validateTerminalCwd, replayBytes = TERMINAL_LIMITS.replayBytes,
    schedule = setTimeout, cancel = clearTimeout, now = Date.now } = {}) {
    this.userHome = userHome; this.defaultCwd = defaultCwd;
    this.spawnProcess = spawnProcess; this.validateCwd = validateCwd;
    this.replayBytes = Math.max(1, Math.min(replayBytes, TERMINAL_LIMITS.replayBytes));
    this.schedule = schedule; this.cancel = cancel; this.now = now;
    this.sessions = new Map(); this.creations = new Set(); this.pending = 0; this.disposed = false;
  }

  list() { return { sessions: [...this.sessions.values()].map(summary), defaultCwd: this.defaultCwd }; }

  get(id) {
    const entry = this.sessions.get(terminalId(id));
    if (!entry) throw terminalError(404, '终端已关闭或不存在');
    return entry;
  }

  create(input = {}) { return this.createManaged(input); }

  createManaged(input = {}, launch = {}) {
    const creation = this.createSession(input, launch);
    this.creations.add(creation);
    creation.then(() => this.creations.delete(creation), () => this.creations.delete(creation));
    return creation;
  }

  async createSession(input, launch = {}) {
    if (this.disposed) throw terminalError(503, '终端服务已停止');
    const options = terminalCreateInput(input, this.defaultCwd);
    if (this.sessions.size + this.pending >= TERMINAL_LIMITS.sessions) throw terminalError(429, '最多保留 8 个终端，请先关闭不用的终端');
    this.pending++;
    try {
      await this.validateCwd(options.cwd);
      if (this.disposed) throw terminalError(503, '终端服务已停止');
      const pty = await this.spawnProcess({ ...options, ...launch, userHome: this.userHome });
      if (this.disposed) { await pty.kill(); throw terminalError(503, '终端服务已停止'); }
      const entry = { ...options, id: randomUUID(), title: options.kind === 'claude' ? 'Claude CLI' : '终端',
        status: 'running', exitCode: null, replayTruncated: false, replay: Buffer.alloc(0), pty, writer: null, subscriptions: [],
        inputLine: cleanTerminalInputLine() };
      this.sessions.set(entry.id, entry);
      entry.subscriptions.push(pty.onData(data => this.output(entry, data)));
      entry.subscriptions.push(pty.onExit(event => {
        if (entry.status !== 'running') return;
        this.cancelRedraw(entry);
        entry.status = 'exited'; entry.exitCode = Number.isInteger(event.exitCode) ? event.exitCode : null;
        this.send(entry, { type: 'exit', exitCode: entry.exitCode });
      }));
      return summary(entry);
    } finally { this.pending--; }
  }

  output(entry, data) {
    if (!this.sessions.has(entry.id) || typeof data !== 'string') return;
    const appended = Buffer.concat([entry.replay, Buffer.from(data)]);
    let offset = Math.max(0, appended.length - this.replayBytes);
    if (offset) {
      entry.replayTruncated = true;
      while (offset < appended.length && (appended[offset] & 0xc0) === 0x80) offset++;
    }
    entry.replay = appended.subarray(offset);
    this.send(entry, { type: 'data', data });
  }

  send(entry, frame) {
    if (!entry.writer) return;
    try { entry.writer.send(frame); } catch { this.disconnect(entry, 4002, '终端连接过慢，请重新连接'); }
  }

  disconnect(entry, code, reason) {
    const writer = entry.writer; entry.writer = null;
    this.cancelRedraw(entry);
    try { writer?.close(code, reason); } catch {}
  }

  cancelRedraw(entry, restore = true) {
    if (!entry.redraw) return;
    const { timer, size } = entry.redraw;
    this.cancel(timer);
    entry.redraw = null;
    if (restore && size && (size.cols !== entry.cols || size.rows !== entry.rows)) {
      this.send(entry, { type: 'redraw-size', cols: entry.cols, rows: entry.rows });
      try { entry.pty.resize(entry.cols, entry.rows); } catch {}
    }
  }

  redraw(entry) {
    if (entry.kind !== 'claude' || entry.status !== 'running') throw terminalError(409, 'Claude 终端当前无法重绘');
    if (entry.redraw) return;
    const state = entry.redraw = { timer: null, size: null };
    // Match xterm's width to each PTY width before Claude emits its repaint.
    const step = index => {
      if (entry.redraw !== state || this.sessions.get(entry.id) !== entry || entry.status !== 'running') return;
      if (index === 4) { entry.redraw = null; return; }
      const size = { cols: index % 2 ? entry.cols : entry.cols > 2 ? entry.cols - 1 : entry.cols + 1, rows: entry.rows };
      state.size = size;
      this.send(entry, { type: 'redraw-size', ...size });
      if (!entry.writer) { this.cancelRedraw(entry); return; }
      try { entry.pty.resize(size.cols, size.rows); }
      catch { this.cancelRedraw(entry); return; }
      state.timer = this.schedule(() => step(index + 1), 110);
    };
    step(0);
  }

  connect(id, transport) {
    const entry = this.get(id);
    this.disconnect(entry, 4001, '另一连接已接管终端');
    const writer = { ...transport }; entry.writer = writer;
    this.send(entry, readyFrame(entry));
    if (entry.status === 'exited') this.send(entry, { type: 'exit', exitCode: entry.exitCode });
    return {
      receive: frame => {
        if (entry.writer !== writer) throw terminalError(409, '另一连接已接管终端');
        const input = terminalClientFrame(frame);
        if (entry.status !== 'running') throw terminalError(409, '终端进程已结束');
        if (input.type === 'input') { entry.pty.write(input.data); entry.inputLine = terminalInputLine(entry.inputLine, input.data, this.now()); }
        else if (input.type === 'redraw') this.redraw(entry);
        else { this.cancelRedraw(entry, false); entry.pty.resize(input.cols, input.rows); entry.cols = input.cols; entry.rows = input.rows; }
      },
      detach: () => { if (entry.writer === writer) { entry.writer = null; this.cancelRedraw(entry); } },
    };
  }

  // Server-side input (e.g. Claude settings commands) goes through the same input-line tracking.
  write(id, data) {
    const entry = this.get(id);
    if (entry.status !== 'running') throw terminalError(409, '终端进程已结束');
    entry.pty.write(data); entry.inputLine = terminalInputLine(entry.inputLine, data, this.now());
    return terminalInputLineView(entry.inputLine);
  }

  // { dirty, at, seq }: whether the input line may hold unsubmitted text, the last input time (ms)
  // and a count of input frames (see terminal-input-line).
  inputLine(id) { return terminalInputLineView(this.get(id).inputLine); }

  async close(id) {
    const entry = this.get(id);
    this.cancelRedraw(entry);
    this.sessions.delete(entry.id); this.disconnect(entry, 4000, '终端已关闭');
    for (const subscription of entry.subscriptions) subscription?.dispose?.();
    if (entry.status === 'running') await entry.pty.kill();
    return { ok: true };
  }

  async dispose() {
    this.disposed = true;
    await Promise.allSettled([...this.creations, ...[...this.sessions.values()].map(async entry => {
      this.disconnect(entry, 1001, '终端服务已停止');
      await this.close(entry.id);
    })]);
  }
}
