import { terminalMessage } from "./presentation.js";

// A terminal owns its display and connection; the backend owns its process.
export function createTerminalSession(initialSession, {
  host, onChange = () => {}, TerminalCtor = globalThis.Terminal,
  FitAddonCtor = globalThis.FitAddon?.FitAddon, WebSocketCtor = globalThis.WebSocket,
  locationRef = globalThis.location, ResizeObserverCtor = globalThis.ResizeObserver,
  schedule = setTimeout, cancel = clearTimeout
}) {
  let session = initialSession;
  let connection = "disconnected";
  let error = "";
  let socket = null;
  let ready = false;
  let visible = false;
  let disposed = false;
  let retryTimer = null;
  let attempts = 0;
  let pendingInput = null;
  let pasteOperation = null;
  let pendingOutputBytes = 0;
  const pendingWrites = new Set();
  const outputEncoder = new TextEncoder();
  const outputLimit = 2 * 1024 * 1024;
  const terminal = new TerminalCtor({
    cursorBlink: true, fontSize: 13, fontFamily: '"SFMono-Regular", Menlo, Consolas, monospace',
    scrollback: 5000, allowProposedApi: false, disableStdin: true,
    theme: { background: "#171719", foreground: "#e4e4e7", cursor: "#e4e4e7", selectionBackground: "#44444c" },
    linkHandler: { activate() {}, hover() {}, leave() {} }
  });
  const fitAddon = new FitAddonCtor();
  terminal.loadAddon(fitAddon);
  terminal.open(host);

  const interruptedInput = "输入可能已部分交给终端，后续回车已取消；请检查终端后再操作。";
  function writable(current = socket) {
    return !disposed && ready && current && socket === current && current.readyState === 1 && session.status === "running";
  }
  function snapshot() { return { session, connection, error, canInput: Boolean(visible && writable()), sending: Boolean(pendingInput) }; }
  function publish() { onChange(snapshot()); }
  function finishInput(token, result) {
    if (pendingInput !== token) return;
    cancel(token.timer);
    pendingInput = null;
    token.resolve(result);
    publish();
  }
  function cancelInput() {
    if (pendingInput) finishInput(pendingInput, { ok: false, message: interruptedInput });
  }
  function pauseOutput(current, message) {
    if (socket !== current || disposed) return;
    ready = false;
    cancelInput();
    terminal.options.disableStdin = true;
    cancel(retryTimer);
    socket = null;
    connection = "error";
    error = message;
    current.close(4002, "terminal display paused");
    publish();
  }
  function writeOutput(current, data, onParsed) {
    const bytes = outputEncoder.encode(data).byteLength;
    if (pendingOutputBytes + bytes > outputLimit) {
      pauseOutput(current, "输出过快，显示已暂停；终端进程仍在运行。请稍后重新连接。");
      return;
    }
    // Tokens account for each queued write once, including callbacks from an old socket.
    const token = { bytes };
    pendingWrites.add(token);
    pendingOutputBytes += bytes;
    const release = () => {
      if (!pendingWrites.delete(token)) return false;
      pendingOutputBytes -= token.bytes;
      return true;
    };
    try {
      terminal.write(data, () => {
        if (release() && socket === current && !disposed) onParsed?.();
      });
    } catch {
      release();
      pauseOutput(current, "终端显示遇到问题，显示已暂停；终端进程仍在运行。请重新连接。");
    }
  }
  function send(frame, current = socket) {
    if (!writable(current)) return false;
    try { current.send(JSON.stringify(frame)); return true; }
    catch { cancelInput(); error = "输入未完整交给终端，请检查连接和终端内容后重试。"; publish(); return false; }
  }
  function fit() {
    if (!visible || disposed || host.getBoundingClientRect().width < 1 || host.getBoundingClientRect().height < 1) return;
    fitAddon.fit();
    send({ type: "resize", cols: terminal.cols, rows: terminal.rows });
  }
  const inputSubscription = terminal.onData((data) => {
    const operation = pasteOperation;
    // Direct terminal typing remains raw, but must not inherit a pending composer Enter.
    // Reports xterm generates by itself (mouse tracking, focus in/out, cursor position,
    // device attributes) are forwarded unchanged but are not typing, so they keep it.
    const report = /^(?:\u001b\[<\d+;\d+;\d+[Mm]|\u001b\[M[\s\S]{3}|\u001b\[[IO]|\u001b\[\d+;\d+R|\u001b\[[?>][\d;]*c)+$/u;
    if (!operation && !report.test(data)) cancelInput();
    if (operation?.failed) return;
    // Bound pasted input frames without splitting a Unicode surrogate pair.
    for (let start = 0; start < data.length;) {
      let end = Math.min(start + 8192, data.length);
      if (end < data.length && /[\uD800-\uDBFF]/u.test(data[end - 1])) end--;
      if (!send({ type: "input", data: data.slice(start, end) }, operation?.socket || socket)) {
        if (operation) operation.failed = true;
        break;
      }
      if (operation) operation.frames++;
      start = end;
    }
  });
  const observer = new ResizeObserverCtor(fit);
  observer.observe(host);

  function inputGate() {
    if (pendingInput) return "上一条输入仍在交给终端，请稍候。";
    if (!visible || !writable()) return "终端暂不可输入，请先连接并切换到正在运行的会话。";
    return "";
  }
  function pasteText(text, { submit = false } = {}) {
    const issue = inputGate() || (typeof text !== "string" || !text.length ? "请输入内容。"
      : /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(text) ? "底部输入仅支持普通文本，请在终端直接使用控制按键。"
      : outputEncoder.encode(text).byteLength > 65536 ? "输入超过 64 KiB，请缩短后再发送。"
      : /[\r\n]/u.test(text) && !terminal.modes?.bracketedPasteMode ? "当前程序未启用多行粘贴，请在终端直接输入。" : "");
    if (issue) return Promise.resolve({ ok: false, message: issue });
    return new Promise((resolve) => {
      const token = pendingInput = { socket, resolve, frames: 0, failed: false, timer: null };
      publish();
      pasteOperation = token;
      try { terminal.paste(text); } catch { token.failed = true; }
      finally { pasteOperation = null; }
      if (pendingInput !== token) return;
      if (token.failed || !token.frames) { finishInput(token, { ok: false, message: interruptedInput }); return; }
      if (!submit) { finishInput(token, { ok: true }); return; }
      token.timer = schedule(() => {
        if (pendingInput !== token) return;
        const ok = Boolean(visible && writable(token.socket) && send({ type: "input", data: "\r" }, token.socket));
        finishInput(token, ok ? { ok: true } : { ok: false, message: interruptedInput });
      }, 50);
    });
  }
  function sendKey(key) {
    const keys = { enter: "\r", escape: "\u001b", interrupt: "\u0003", tab: "\t", up: "\u001b[A", down: "\u001b[B", eof: "\u0004" };
    if (!Object.hasOwn(keys, key)) return { ok: false, message: "不支持这个终端按键。" };
    if (key === "interrupt" || key === "escape") cancelInput();
    const issue = inputGate();
    if (issue) return { ok: false, message: issue };
    return send({ type: "input", data: keys[key] }) ? { ok: true } : { ok: false, message: interruptedInput };
  }

  function connect() {
    if (disposed || socket && socket.readyState < 2) return;
    cancel(retryTimer);
    ready = false;
    cancelInput();
    terminal.options.disableStdin = true;
    error = "";
    connection = attempts ? "retrying" : "connecting";
    publish();
    const url = new URL("/api/terminal/socket", locationRef.href);
    url.protocol = locationRef.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("id", session.id);
    const current = socket = new WebSocketCtor(url.href);
    current.onmessage = (event) => {
      if (socket !== current || disposed) return;
      let frame;
      try { frame = JSON.parse(event.data); } catch { return; }
      if (frame.type === "ready") {
        session = frame.session;
        // Keep replay-generated terminal replies out of the live process.
        ready = false;
        cancelInput();
        terminal.reset();
        terminal.resize(session.cols, session.rows);
        const replay = session.replayTruncated
          ? '\x1b[2J\x1b[H\r\n[此前输出超出缓存，显示已重置；会话仍在运行]\r\n'
          : frame.replay || '';
        writeOutput(current, replay, () => {
          if (socket !== current || current.readyState !== 1 || disposed) return;
          ready = true;
          attempts = 0;
          connection = "connected";
          terminal.options.disableStdin = session.status !== "running";
          fit();
          publish();
        });
      } else if (frame.type === "data") {
        if (typeof frame.data === "string") writeOutput(current, frame.data);
      } else if (frame.type === "exit") {
        session = { ...session, status: "exited", exitCode: frame.exitCode };
        cancelInput();
        terminal.options.disableStdin = true;
        publish();
      } else if (frame.type === "error") {
        error = terminalMessage(frame, "终端连接遇到问题，请重新连接。");
        publish();
      }
    };
    current.onclose = (event) => {
      if (socket !== current || disposed) return;
      ready = false;
      cancelInput();
      terminal.options.disableStdin = true;
      socket = null;
      connection = event.code === 4001 ? "takenover" : event.code === 4000 ? "closed" : "disconnected";
      if (event.code === 4000) session = { ...session, status: "exited" };
      const retryable = ![4000, 4001, 4002].includes(event.code) && session.status === "running";
      if (retryable && attempts < 5) {
        connection = "retrying";
        retryTimer = schedule(connect, Math.min(1000 * 2 ** attempts++, 10000));
      }
      publish();
    };
    current.onerror = () => {
      if (socket === current && !disposed) { cancelInput(); error = "暂时无法连接终端。进程状态将在重新连接后确认。"; publish(); }
    };
  }

  return {
    snapshot, pasteText, sendKey,
    focus() { if (visible && !disposed) terminal.focus(); },
    update(value) { session = value; if (session.status !== "running") cancelInput(); publish(); },
    activate() { visible = true; host.hidden = false; fit(); terminal.focus(); if (connection === "disconnected" && !attempts) connect(); else publish(); },
    deactivate() { visible = false; host.hidden = true; cancelInput(); publish(); },
    reconnect() { attempts = 0; connect(); },
    dispose() {
      disposed = true;
      ready = false;
      cancelInput();
      cancel(retryTimer);
      observer.disconnect();
      inputSubscription.dispose();
      socket?.close();
      socket = null;
      terminal.dispose();
      host.remove();
    }
  };
}
