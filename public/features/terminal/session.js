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

  function publish() { onChange({ session, connection, error }); }
  function pauseOutput(current, message) {
    if (socket !== current || disposed) return;
    ready = false;
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
  function send(frame) {
    if (!ready || socket?.readyState !== 1 || session.status !== "running") return;
    socket.send(JSON.stringify(frame));
  }
  function fit() {
    if (!visible || disposed || host.getBoundingClientRect().width < 1 || host.getBoundingClientRect().height < 1) return;
    fitAddon.fit();
    send({ type: "resize", cols: terminal.cols, rows: terminal.rows });
  }
  const inputSubscription = terminal.onData((data) => {
    // Bound pasted input frames without splitting a Unicode surrogate pair.
    for (let start = 0; start < data.length;) {
      let end = Math.min(start + 8192, data.length);
      if (end < data.length && /[\uD800-\uDBFF]/u.test(data[end - 1])) end--;
      send({ type: "input", data: data.slice(start, end) });
      start = end;
    }
  });
  const observer = new ResizeObserverCtor(fit);
  observer.observe(host);

  function connect() {
    if (disposed || socket && socket.readyState < 2) return;
    cancel(retryTimer);
    ready = false;
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
        terminal.reset();
        terminal.resize(session.cols, session.rows);
        writeOutput(current, frame.replay || "", () => {
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
      if (socket === current && !disposed) { error = "暂时无法连接终端。进程状态将在重新连接后确认。"; publish(); }
    };
  }

  return {
    snapshot: () => ({ session, connection, error }),
    update(value) { session = value; publish(); },
    activate() { visible = true; host.hidden = false; fit(); terminal.focus(); if (connection === "disconnected" && !attempts) connect(); },
    deactivate() { visible = false; host.hidden = true; },
    reconnect() { attempts = 0; connect(); },
    dispose() {
      disposed = true;
      ready = false;
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
