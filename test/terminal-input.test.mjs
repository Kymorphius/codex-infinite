import test from "node:test";
import assert from "node:assert/strict";
import { createTerminalSession } from "../public/features/terminal/session.js";

function harness({ connected = true, bracketed = true } = {}) {
  const sockets = [], timers = [], changes = [];
  let terminal;
  class Terminal {
    constructor(options) { terminal = this; this.options = options; this.modes = { bracketedPasteMode: bracketed }; this.callbacks = []; }
    loadAddon() {}
    open() {}
    onData(callback) { this.input = callback; return { dispose() {} }; }
    resize(cols, rows) { this.cols = cols; this.rows = rows; }
    reset() {}
    write(data, callback) { this.callbacks.push(callback); }
    paste(text) {
      this.pasted = text;
      if (this.throwPaste === "before") throw new Error("paste failed");
      if (!this.skipPaste) this.input(this.modes.bracketedPasteMode ? `\u001b[200~${text.replace(/\r?\n/g, "\r")}\u001b[201~` : text);
      if (this.throwPaste === "after") throw new Error("paste failed after data");
    }
    focus() { this.focused = true; }
    dispose() {}
  }
  class Socket {
    constructor() { this.readyState = 1; this.sent = []; sockets.push(this); }
    send(data) {
      if (this.failAfter !== undefined && this.sent.length >= this.failAfter) throw new Error("socket failure");
      this.sent.push(JSON.parse(data));
    }
    close() { this.readyState = 3; }
    receive(frame) { this.onmessage({ data: JSON.stringify(frame) }); }
    disconnect(code = 1006) { this.readyState = 3; this.onclose({ code }); }
  }
  const session = { id: "one", status: "running", cols: 80, rows: 24 };
  const view = createTerminalSession(session, {
    host: { getBoundingClientRect: () => ({ width: 1, height: 1 }), remove() {} },
    TerminalCtor: Terminal, FitAddonCtor: class { fit() {} }, WebSocketCtor: Socket,
    ResizeObserverCtor: class { observe() {} disconnect() {} },
    locationRef: { href: "http://127.0.0.1/", protocol: "http:" }, onChange: (value) => changes.push(value),
    schedule(callback, delay) { const timer = { callback, delay }; timers.push(timer); return timer; },
    cancel(timer) { if (timer) timer.cancelled = true; }
  });
  const ready = () => { sockets.at(-1).receive({ type: "ready", session, replay: "" }); terminal.callbacks.shift()(); };
  if (connected) { view.activate(); ready(); }
  const input = (socket = sockets.at(-1)) => socket.sent.filter((frame) => frame.type === "input").map((frame) => frame.data);
  return { view, terminal, sockets, timers, changes, session, ready, input };
}

test("composer paste uses native paste semantics and sends Enter later on the same connection", async () => {
  const h = harness();
  const pending = h.view.pasteText("你好\n第二行\t内容", { submit: true });
  assert.equal(h.terminal.pasted, "你好\n第二行\t内容");
  assert.deepEqual(h.input(), ["\u001b[200~你好\r第二行\t内容\u001b[201~"]);
  assert.equal(h.view.snapshot().sending, true);
  assert.equal(h.view.snapshot().canInput, true);
  assert.ok(h.changes.some((change) => change.sending));
  assert.equal((await h.view.pasteText("duplicate", { submit: true })).ok, false);
  assert.equal(h.view.sendKey("enter").ok, false);
  assert.ok(h.timers[0].delay > 0);
  h.timers[0].callback();
  assert.deepEqual(await pending, { ok: true });
  assert.deepEqual(h.input(), ["\u001b[200~你好\r第二行\t内容\u001b[201~", "\r"]);
  assert.equal(h.view.snapshot().sending, false);
  assert.equal(h.view.snapshot().canInput, true);
});

test("paste-only never schedules Enter and ordinary single-line text works without bracketed paste", async () => {
  const h = harness({ bracketed: false });
  assert.deepEqual(await h.view.pasteText("echo 你好"), { ok: true });
  assert.deepEqual(h.input(), ["echo 你好"]);
  assert.equal(h.timers.length, 0);
  for (const text of ["one\ntwo", "one\rtwo", "one\r\ntwo"]) {
    const result = await h.view.pasteText(text, { submit: true });
    assert.equal(result.ok, false);
    assert.match(result.message, /多行粘贴/u);
  }
  assert.equal(h.input().length, 1);
});

test("composer rejects control text and UTF-8 over 64 KiB while native input remains unrestricted", async () => {
  const h = harness();
  for (const text of ["", null, "cmd\u001b[H", "cmd\u0003", "cmd\u0000", "cmd\u007f", "cmd\u009b", "文".repeat(21846)]) {
    assert.equal((await h.view.pasteText(text)).ok, false);
  }
  assert.deepEqual(h.input(), []);
  assert.deepEqual(await h.view.pasteText("a".repeat(65536)), { ok: true });
  assert.ok(h.input().every((chunk) => Buffer.byteLength(chunk) < 65536));
  const raw = "\u001b[H\u0003\u0004\t\u0000";
  h.terminal.input(raw);
  assert.equal(h.input().at(-1), raw);
});

test("input gates remain closed before replay, while hidden, after exit and after disposal", async () => {
  const h = harness({ connected: false });
  const reject = async () => {
    assert.equal(h.view.snapshot().canInput, false);
    assert.equal((await h.view.pasteText("hello", { submit: true })).ok, false);
    assert.equal(h.view.sendKey("enter").ok, false);
  };
  await reject();
  h.view.activate();
  h.sockets[0].receive({ type: "ready", session: h.session, replay: "history" });
  await reject();
  h.terminal.callbacks.shift()();
  assert.equal(h.view.snapshot().canInput, true);
  h.view.deactivate();
  await reject();
  h.view.activate();
  h.sockets[0].receive({ type: "exit", exitCode: 0 });
  await reject();
  h.view.dispose();
  await reject();
  assert.deepEqual(h.input(), []);
});

test("disconnect and takeover cancel a pending Enter without sending it to a reconnected socket", async () => {
  for (const code of [1006, 4001, 4000, 4002]) {
    const h = harness();
    const pending = h.view.pasteText("draft", { submit: true });
    const delayed = h.timers[0];
    h.sockets[0].disconnect(code);
    const result = await pending;
    assert.equal(result.ok, false);
    assert.match(result.message, /可能已部分/u);
    assert.equal(delayed.cancelled, true);
    if (code !== 4000) { h.view.reconnect(); h.ready(); }
    delayed.callback();
    assert.equal(h.input(h.sockets[0]).includes("\r"), false);
    assert.equal(h.input().includes("\r"), false);
    assert.equal(h.view.snapshot().sending, false);
  }
});

test("deactivation, exit, refreshed status, replay restart, socket error and disposal cancel delayed Enter", async () => {
  const actions = [
    (h) => h.view.deactivate(), (h) => h.sockets[0].receive({ type: "exit", exitCode: 0 }),
    (h) => h.view.update({ ...h.session, status: "exited" }),
    (h) => h.sockets[0].receive({ type: "ready", session: h.session, replay: "" }),
    (h) => h.sockets[0].onerror(), (h) => h.view.dispose()
  ];
  for (const action of actions) {
    const h = harness();
    const pending = h.view.pasteText("draft", { submit: true });
    action(h);
    assert.equal((await pending).ok, false);
    h.timers[0].callback();
    assert.equal(h.input().includes("\r"), false);
  }
});

test("direct terminal input cancels delayed composer Enter and still delivers the exact raw bytes", async () => {
  const h = harness();
  const pending = h.view.pasteText("draft", { submit: true });
  h.terminal.input("\u001b[A\u0003");
  assert.equal((await pending).ok, false);
  h.timers[0].callback();
  assert.deepEqual(h.input(), ["\u001b[200~draft\u001b[201~", "\u001b[A\u0003"]);
});

test("mouse, focus and query reports from the terminal itself keep the delayed composer Enter", async () => {
  const h = harness();
  const pending = h.view.pasteText("draft", { submit: true });
  const reports = ["\u001b[<35;35;34M", "\u001b[<0;10;5m", "\u001b[O", "\u001b[I", "\u001b[12;40R", "\u001b[?1;2c", "\u001b[M !!", "\u001b[<35;33;34M\u001b[<35;30;33M"];
  for (const report of reports) h.terminal.input(report);
  assert.equal(h.view.snapshot().sending, true, "reports are not typing");
  h.timers[0].callback();
  assert.deepEqual(await pending, { ok: true });
  assert.deepEqual(h.input(), ["\u001b[200~draft\u001b[201~", ...reports, "\r"], "reports are still forwarded unchanged");
  const typed = h.view.pasteText("again", { submit: true });
  h.terminal.input("\u001b[O" + "x");
  assert.equal((await typed).ok, false, "a report glued to a real key is typing");
});

test("interrupt and escape cancel pending submission before delivering their native control key", async () => {
  for (const [key, value] of [["interrupt", "\u0003"], ["escape", "\u001b"]]) {
    const h = harness();
    const pending = h.view.pasteText("draft", { submit: true });
    assert.deepEqual(h.view.sendKey(key), { ok: true });
    assert.equal((await pending).ok, false);
    h.timers[0].callback();
    assert.deepEqual(h.input(), ["\u001b[200~draft\u001b[201~", value]);
  }
});

test("native key actions share the active socket and focus is limited to a visible live view", () => {
  const h = harness();
  for (const key of ["enter", "escape", "interrupt", "tab", "up", "down", "space", "eof"]) assert.deepEqual(h.view.sendKey(key), { ok: true });
  assert.deepEqual(h.input(), ["\r", "\u001b", "\u0003", "\t", "\u001b[A", "\u001b[B", " ", "\u0004"]);
  assert.equal(h.view.sendKey("unsupported").ok, false);
  h.terminal.focused = false;
  h.view.focus();
  assert.equal(h.terminal.focused, true);
  h.view.deactivate();
  h.terminal.focused = false;
  h.view.focus();
  assert.equal(h.terminal.focused, false);
});

test("throwing or suppressed paste never reports success or leaves a delayed Enter", async () => {
  for (const failure of ["before", "after", "suppressed"]) {
    const h = harness();
    h.terminal.throwPaste = failure;
    h.terminal.skipPaste = failure === "suppressed";
    const result = await h.view.pasteText("draft", { submit: true });
    assert.equal(result.ok, false);
    assert.match(result.message, /可能已部分/u);
    assert.equal(h.timers.length, 0);
    assert.equal(h.view.snapshot().sending, false);
  }
});

test("partial socket writes and a failed Enter report uncertainty without automatic retries", async () => {
  const h = harness();
  h.sockets[0].failAfter = h.sockets[0].sent.length + 1;
  const result = await h.view.pasteText("x".repeat(20000), { submit: true });
  assert.equal(result.ok, false);
  assert.match(result.message, /可能已部分/u);
  assert.equal(h.input().length, 1);
  assert.equal(h.timers.length, 0);
  assert.equal(h.view.snapshot().sending, false);
  const next = harness();
  const pending = next.view.pasteText("draft", { submit: true });
  next.sockets[0].failAfter = next.sockets[0].sent.length;
  next.timers[0].callback();
  assert.equal((await pending).ok, false);
  assert.equal(next.input().length, 1);
  assert.equal(next.view.snapshot().sending, false);
});
