// While the program has mouse tracking on (Claude's full-screen view), xterm turns each
// wheel event into at most one wheel report and damps small trackpad deltas to 30%, so
// slow trackpad motion lags and fast motion is dropped. This handler instead converts the
// scrolled distance into one report per text row, sent once per animation frame, so the
// content follows the finger and macOS momentum carries through. Other modes keep xterm's
// own handling (local scrollback, alternate-screen arrow keys).
export function installTerminalWheel(terminal, {
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
  cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis),
  maxPerFrame = 24
} = {}) {
  const mouse = terminal._core?.coreMouseService;
  if (typeof terminal.attachCustomWheelEventHandler !== 'function' || typeof mouse?.triggerMouseEvent !== 'function' || !requestFrame) return { dispose() {} };
  let rows = 0, frame = null, last = null, disposed = false;
  const screen = () => terminal.element?.querySelector?.('.xterm-screen');
  function flush() {
    frame = null;
    if (disposed || !last) return;
    const count = Math.min(Math.trunc(Math.abs(rows)), maxPerFrame), up = rows < 0;
    rows -= (up ? -count : count);
    for (let i = 0; i < count; i++) mouse.triggerMouseEvent({ ...last, action: up ? 0 : 1 });
    if (Math.abs(rows) >= 1) frame = requestFrame(flush);
  }
  terminal.attachCustomWheelEventHandler(event => {
    if (disposed || terminal.modes?.mouseTrackingMode === 'none' || !event.deltaY || event.shiftKey) return true;
    const box = screen()?.getBoundingClientRect?.();
    if (!box?.height || !terminal.rows || !terminal.cols) return true;
    const cellHeight = box.height / terminal.rows, cellWidth = box.width / terminal.cols;
    const delta = event.deltaMode === 1 ? event.deltaY : event.deltaMode === 2 ? event.deltaY * terminal.rows : event.deltaY / cellHeight;
    if (Math.sign(delta) !== Math.sign(rows)) rows = 0; // reversing direction drops the unfinished row
    rows += delta;
    const x = Math.max(0, Math.min(box.width - 1, event.clientX - box.left)), y = Math.max(0, Math.min(box.height - 1, event.clientY - box.top));
    last = { col: Math.floor(x / cellWidth), row: Math.floor(y / cellHeight), x, y, button: 4, ctrl: event.ctrlKey, alt: event.altKey, shift: false };
    if (frame === null) frame = requestFrame(flush);
    event.preventDefault?.();
    return false;
  });
  return { dispose() { disposed = true; if (frame !== null) cancelFrame?.(frame); frame = null; } };
}
