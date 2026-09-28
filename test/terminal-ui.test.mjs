import test from "node:test";
import assert from "node:assert/strict";
import { createTerminalSession } from "../public/features/terminal/session.js";
import { isAbsoluteTerminalDirectory, readSelectedTerminal, saveSelectedTerminal, selectListedTerminal, terminalDirectories, terminalStatus, terminalMessage, terminalTabTitle } from "../public/features/terminal/presentation.js";

function harness({ onUiCommand = null, kind = 'shell' } = {}) {
  const sockets = [];
  const timers = [];
  const terminals = [];
  const observers = [];
  let fits = 0;
  class Terminal {
    constructor(options) { this.options = options; this.writes = []; this.callbacks = []; this.parser = { registerOscHandler: (code, handler) => { this.oscCode = code; this.oscHandler = handler; return { dispose: () => { this.oscHandler = null; } }; } }; terminals.push(this); }
    loadAddon() {}
    open() {}
    onData(callback) { this.input = callback; return { dispose() {} }; }
    resize(cols, rows) { this.cols = cols; this.rows = rows; }
    reset() { this.resets = (this.resets || 0) + 1; }
    write(data, callback) { if (this.throwWrite) throw new Error("parser unavailable"); this.writes.push(data); if (callback) this.callbacks.push(callback); }
    focus() {}
    dispose() { this.disposed = true; }
  }
  class Socket {
    constructor(url) { this.url = url; this.readyState = 1; this.sent = []; sockets.push(this); }
    send(data) { this.sent.push(JSON.parse(data)); }
    close(code) { this.closed = true; this.closeCode = code; this.readyState = 2; }
    receive(frame) { this.onmessage({ data: JSON.stringify(frame) }); }
    disconnect(code = 1006) { this.readyState = 3; this.onclose({ code }); }
  }
  class Observer {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  }
  const host = { hidden: false, getBoundingClientRect: () => ({ width: 800, height: 500 }), remove() { this.removed = true; } };
  const session = { id: "terminal-one", title: "终端", cwd: "/project", kind, status: "running", cols: 80, rows: 24 };
  const view = createTerminalSession(session, {
    host, TerminalCtor: Terminal, FitAddonCtor: class { fit() { fits++; } },
    WebSocketCtor: Socket, ResizeObserverCtor: Observer,
    locationRef: { href: "http://127.0.0.1:4321/?module=terminal", protocol: "http:" }, onUiCommand,
    schedule(callback, delay) { const timer = { callback, delay }; timers.push(timer); return timer; },
    cancel(timer) { if (timer) timer.cancelled = true; }
  });
  return { view, session, host, sockets, terminals, observers, timers, fits: () => fits };
}

test("restoring a terminal only connects to its existing ID, and replay cannot send live input", () => {
  const h = harness();
  assert.equal(h.sockets.length, 0);
  h.view.activate();
  assert.equal(h.sockets[0].url, "ws://127.0.0.1:4321/api/terminal/socket?id=terminal-one");
  const socket = h.sockets[0];
  const terminal = h.terminals[0];
  socket.receive({ type: "ready", session: h.session, replay: "old\u001b[6n" });
  terminal.input("\u001b[1;1R");
  assert.equal(socket.sent.length, 0);
  terminal.callbacks.shift()();
  terminal.input("你好\u0003");
  assert.deepEqual(socket.sent.at(-1), { type: "input", data: "你好\u0003" });
  assert.equal(h.view.snapshot().connection, "connected");
  socket.receive({ type: "data", data: "new" });
  assert.deepEqual(terminal.writes, ["old\u001b[6n", "new"]);
});

test('Claude display commands run only from live output in the current visible session', () => {
  const commands = [], h = harness({ kind: 'claude', onUiCommand: action => commands.push(action) });
  const terminal = h.terminals[0]; assert.equal(terminal.oscCode, 777);
  h.view.activate();
  h.sockets[0].receive({ type: 'ready', session: h.session, replay: '\u001b]777;ccc-ui:split=open\u0007' });
  assert.equal(terminal.oscHandler('ccc-ui:split=open'), true);
  assert.deepEqual(commands, [], 'replayed display commands are inert');
  terminal.callbacks.shift()();
  assert.equal(terminal.oscHandler('ccc-ui:split=open'), true);
  assert.equal(terminal.oscHandler('ccc-ui:redraw'), true);
  assert.equal(terminal.oscHandler('ccc-ui:unknown'), true);
  assert.equal(terminal.oscHandler('other-protocol'), false);
  assert.deepEqual(commands, ['split=open', 'redraw']);
  h.view.deactivate(); terminal.oscHandler('ccc-ui:split=close');
  assert.deepEqual(commands, ['split=open', 'redraw'], 'hidden sessions do not act');
  h.view.dispose(); assert.equal(terminal.oscHandler, null);
  const shellCommands = [], shell = harness({ kind: 'shell', onUiCommand: action => shellCommands.push(action) });
  shell.view.activate(); shell.sockets[0].receive({ type: 'ready', session: shell.session, replay: '' });
  shell.terminals[0].callbacks.shift()(); shell.terminals[0].oscHandler('ccc-ui:redraw');
  assert.deepEqual(shellCommands, [], 'shell sessions do not control Claude UI'); shell.view.dispose();
});

test("module and session switches preserve the same display/socket and never resize hidden terminals", () => {
  const h = harness();
  h.view.activate();
  const before = h.fits();
  h.view.deactivate();
  h.observers[0].callback();
  assert.equal(h.fits(), before);
  assert.equal(h.host.hidden, true);
  assert.equal(h.sockets[0].closed, undefined);
  h.view.activate();
  assert.equal(h.sockets.length, 1);
  assert.equal(h.terminals.length, 1);
  assert.equal(h.host.hidden, false);
});

test("large Unicode paste is split into bounded frames without breaking surrogate pairs", () => {
  const h = harness();
  h.view.activate();
  h.sockets[0].receive({ type: "ready", session: h.session, replay: "" });
  h.terminals[0].callbacks.shift()();
  const input = "字".repeat(8191) + "😀" + "文".repeat(30000);
  h.terminals[0].input(input);
  const chunks = h.sockets[0].sent.filter((frame) => frame.type === "input").map((frame) => frame.data);
  assert.equal(chunks.join(""), input);
  assert.ok(chunks.every((chunk) => Buffer.byteLength(chunk) < 65536));
  assert.ok(chunks.every((chunk) => !/[\uD800-\uDBFF]$/u.test(chunk) && !/^[\uDC00-\uDFFF]/u.test(chunk)));
});

test("connection takeover never fights another page and requires explicit reconnect", () => {
  const h = harness();
  h.view.activate();
  h.sockets[0].disconnect(4001);
  assert.equal(h.view.snapshot().connection, "takenover");
  h.view.deactivate();
  h.view.activate();
  assert.equal(h.sockets.length, 1);
  assert.equal(h.timers.length, 0);
  h.view.reconnect();
  assert.equal(h.sockets.length, 2);
});

test('redraw reconnects an already connected display to the same PTY without sending input', () => {
  const h = harness({ kind: 'claude' }); h.view.activate();
  const first = h.sockets[0]; first.receive({ type: 'ready', session: h.session, replay: 'before' });
  h.terminals[0].callbacks.shift()(); assert.equal(h.view.snapshot().connection, 'connected');
  h.view.reconnect();
  assert.equal(first.closed, true); assert.equal(h.sockets.length, 2);
  assert.match(h.sockets[1].url, /id=terminal-one$/u); assert.deepEqual(first.sent.filter(frame => frame.type === 'input'), []);
  h.sockets[1].receive({ type: 'ready', session: h.session, replay: 'after' });
  h.terminals[0].callbacks.shift()(); assert.equal(h.view.snapshot().connection, 'connected');
  assert.equal(h.terminals[0].resets, 2);
});

test("reconnect is bounded, drops offline input and ignores stale replay completion", () => {
  const h = harness();
  h.view.activate();
  h.sockets[0].receive({ type: "ready", session: h.session, replay: "old" });
  h.sockets[0].disconnect();
  h.terminals[0].input("do not queue");
  h.terminals[0].callbacks.shift()();
  assert.equal(h.view.snapshot().connection, "retrying");
  assert.equal(h.sockets[0].sent.length, 0);
  for (let index = 0; index < 5; index++) {
    h.timers[index].callback();
    h.sockets.at(-1).disconnect();
  }
  assert.equal(h.timers.length, 5);
  assert.deepEqual(h.timers.map((timer) => timer.delay), [1000, 2000, 4000, 8000, 10000]);
  assert.equal(h.view.snapshot().connection, "disconnected");
  h.view.activate();
  assert.equal(h.sockets.length, 6);
  h.view.reconnect();
  assert.equal(h.sockets.length, 7);
  assert.deepEqual(h.sockets.at(-1).sent, []);
});

test("process exit disables input and disposal cancels browser resources without closing the process", () => {
  const h = harness();
  h.view.activate();
  h.sockets[0].receive({ type: "ready", session: h.session, replay: "" });
  h.terminals[0].callbacks.shift()();
  h.sockets[0].receive({ type: "exit", exitCode: 127 });
  const sent = h.sockets[0].sent.length;
  h.terminals[0].input("ignored");
  assert.equal(h.sockets[0].sent.length, sent);
  assert.equal(h.terminals[0].options.disableStdin, true);
  assert.equal(terminalStatus(h.view.snapshot().session), "已退出 · 退出码 127");
  h.sockets[0].disconnect();
  assert.equal(h.timers.length, 0);
  h.view.dispose();
  assert.equal(h.observers[0].disconnected, true);
  assert.equal(h.terminals[0].disposed, true);
  assert.equal(h.host.removed, true);
});

test("directory suggestions are local absolute paths and terminal errors have readable fallbacks", () => {
  assert.deepEqual(terminalDirectories({ projects: [{ cwd: "/project" }], tasks: [{ cwd: "/project" }, { cwd: "/remote", device: { kind: "remote" } }, { cwd: "relative" }] }, "/home"), ["/home", "/project"]);
  assert.equal(terminalMessage(new Error("ECONNREFUSED"), "连接失败"), "连接失败");
  assert.equal(terminalMessage(new Error("工作目录不存在"), "连接失败"), "工作目录不存在");
  assert.equal(terminalStatus({ status: "running" }, "takenover"), "已由另一个页面接管");
  assert.equal(isAbsoluteTerminalDirectory("C:\\Users\\demo"), true);
  assert.equal(isAbsoluteTerminalDirectory("\\\\server\\share"), true);
  assert.equal(isAbsoluteTerminalDirectory("C:relative"), false);
});

test("refresh restores the selected listed terminal and falls back safely after it disappears", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  const sessions = [{ id: "old", status: "exited" }, { id: "shell", status: "running" }, { id: "claude", status: "running" }];
  saveSelectedTerminal(storage, "claude");
  assert.equal(values.size, 1);
  assert.deepEqual([...values.values()], ["claude"]);
  assert.equal(selectListedTerminal(sessions, readSelectedTerminal(storage)), "claude");
  assert.equal(selectListedTerminal(sessions, "missing"), "shell");
  assert.equal(selectListedTerminal(sessions, "old"), "old");
  assert.equal(selectListedTerminal([], "claude"), "");
  saveSelectedTerminal(storage, "");
  assert.equal(values.size, 0);
  assert.equal(readSelectedTerminal(undefined), "");
  assert.doesNotThrow(() => saveSelectedTerminal(undefined, "claude"));
});

test("duplicate terminal titles receive distinct visible labels including for the same directory", () => {
  const sessions = [{ id: "first", title: "终端", cwd: "/same" }, { id: "second", title: "终端", cwd: "/same" }, { id: "claude", kind: "claude" }];
  assert.equal(terminalTabTitle(sessions[0], sessions), "终端 1");
  assert.equal(terminalTabTitle(sessions[1], sessions), "终端 2");
  assert.equal(terminalTabTitle(sessions[2], sessions), "Claude CLI");
  assert.equal(terminalTabTitle(sessions[0], [sessions[0]]), "终端");
});

test("renderer backlog is bounded by parsed UTF-8 bytes and pauses without automatic reconnect", () => {
  const h = harness();
  h.view.activate();
  const socket = h.sockets[0];
  const terminal = h.terminals[0];
  socket.receive({ type: "ready", session: h.session, replay: "" });
  terminal.callbacks.shift()();
  const chunk = "文".repeat(32768);
  for (let index = 0; index < 22; index++) socket.receive({ type: "data", data: chunk });
  const total = terminal.writes.reduce((bytes, data) => bytes + Buffer.byteLength(data), 0);
  assert.ok(total <= 2 * 1024 * 1024);
  assert.equal(terminal.writes.length, 22);
  assert.equal(socket.closeCode, 4002);
  assert.match(h.view.snapshot().error, /输出过快.*显示已暂停.*进程仍在运行/u);
  assert.equal(h.view.snapshot().connection, "error");
  assert.equal(terminal.options.disableStdin, true);
  const sent = socket.sent.length;
  terminal.input("ignored while paused");
  assert.equal(socket.sent.length, sent);
  socket.disconnect(4002);
  h.view.deactivate();
  h.view.activate();
  assert.equal(h.sockets.length, 1);
  assert.equal(h.timers.length, 0);
  for (const callback of terminal.callbacks.splice(0)) callback();
  h.view.reconnect();
  assert.equal(h.sockets.length, 2);
});

test("old write tokens drain only their own bytes and cannot enable input or lower the new backlog twice", () => {
  const h = harness();
  h.view.activate();
  const terminal = h.terminals[0];
  const chunk = "a".repeat(1024 * 1024);
  h.sockets[0].receive({ type: "ready", session: h.session, replay: chunk });
  const oldCallback = terminal.callbacks.shift();
  h.sockets[0].disconnect(4001);
  h.view.reconnect();
  const current = h.sockets[1];
  current.receive({ type: "ready", session: h.session, replay: chunk });
  oldCallback();
  oldCallback();
  assert.equal(h.view.snapshot().connection, "connecting");
  assert.equal(terminal.options.disableStdin, true);
  current.receive({ type: "data", data: chunk });
  assert.equal(terminal.writes.length, 3);
  current.receive({ type: "data", data: "overflow" });
  assert.equal(current.closeCode, 4002);
  assert.equal(terminal.writes.length, 3);
});

test("a throwing terminal parser pauses safely and permits an explicit recovery", () => {
  const h = harness();
  h.view.activate();
  const terminal = h.terminals[0];
  terminal.throwWrite = true;
  assert.doesNotThrow(() => h.sockets[0].receive({ type: "ready", session: h.session, replay: "history" }));
  assert.equal(h.sockets[0].closeCode, 4002);
  assert.equal(h.view.snapshot().connection, "error");
  assert.match(h.view.snapshot().error, /显示遇到问题/u);
  assert.equal(terminal.options.disableStdin, true);
  assert.equal(h.timers.length, 0);
  terminal.throwWrite = false;
  h.view.reconnect();
  h.sockets[1].receive({ type: "ready", session: h.session, replay: "history" });
  terminal.callbacks.shift()();
  assert.equal(h.view.snapshot().connection, "connected");
  assert.equal(terminal.options.disableStdin, false);
});

test('truncated TUI replay resets the display instead of parsing a partial old screen', () => {
  const h = harness(); h.view.activate();
  const session = { ...h.session, replayTruncated: true };
  h.sockets[0].receive({ type: 'ready', session, replay: '\u001b[?1049hpartial-old-screen' });
  assert.match(h.terminals[0].writes[0], /显示已重置/);
  assert.doesNotMatch(h.terminals[0].writes[0], /partial-old-screen/);
  h.terminals[0].callbacks.shift()();
  assert.equal(h.view.snapshot().connection, 'connected');
  assert.equal(h.sockets[0].sent.some(frame => frame.type === 'resize'), true);
});
