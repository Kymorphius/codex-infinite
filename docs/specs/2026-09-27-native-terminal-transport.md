# Native terminal transport

The macOS ChatGPT 26 CSP blocks the hidden loopback terminal bridge. Showing its
project menu without a usable transport produces a permanent connecting notice.

Use a fixed native Runtime binding for terminal metadata and PTY transport. Only
the top-level `app://-` execution context may call it. Validate bounded requests,
fixed operations and project identity through existing services. Associate PTY
attachments with execution context and random stream tokens; detach on disposal
or context destruction, without killing the process. Bound output queues.

Render the packaged xterm library and conversation composer directly in the native
main workspace. Reuse the terminal session controller for replay, input, paste,
resize and reconnect behavior. Keep project rows and native conversation tabs.
Do not add loopback frames, fetches or WebSockets to the macOS renderer, reload it,
or enable CSP bypass. Windows retains the existing iframe transport.

Verification: validate hostile contexts, malformed operations, stream ownership,
disposal and bounded delivery; run repository checks and tests. Native visual
acceptance must be reported separately from automated service evidence.

## Throughput (2026-09-29)

Scrolling a Claude conversation sends one mouse-wheel report per notch and Claude
redraws the screen for each, so the binding carries many small frames each way.

- The origin check (`app://-`, top frame) runs once per execution context and is
  cached until that context is destroyed or all contexts are cleared. Navigation
  always creates a new context, so no request is served from a stale check.
- Messages to one context stay ordered. While an evaluate is in flight, later
  messages queue and the next evaluate delivers all of them, up to 256 KiB, each
  through `__cccTerminalNativeReceive` in order. The 2 MiB buffered limit is unchanged.
- The page client keeps one input request in flight per stream. Input frames queued
  behind it merge into one `input` frame (concatenated in order, up to 32 KiB); a
  `resize` or `redraw` frame is never merged and keeps its position.

Measured on a live Claude conversation (20 wheel notches up): slowest input ack
7.4 s → 22 ms, main-thread long tasks 15 (2.6 s total) → 0.

## Trackpad scrolling under mouse tracking (2026-09-29)

With mouse tracking on (Claude's full-screen view), xterm 6 turns each wheel event
into at most one wheel report and multiplies pixel deltas under 50 by 0.3. Claude
scrolls one row per report, so slow trackpad motion lagged and fast motion was lost.

- `public/features/terminal/wheel.js` replaces that handling only while mouse
  tracking is on: pixel deltas are divided by the rendered row height (line and page
  deltas are used as rows), accumulated, and sent once per animation frame as one
  wheel report per whole row, at most 24 per frame with the rest on the next frame.
- The pointer's cell is reported, as xterm does. Reversing direction drops the
  unfinished row. Shift/horizontal scrolling, no tracking, and xterm builds without
  the core mouse service keep xterm's default behavior.
- Reports go through xterm's own encoder, so the program's chosen mouse protocol is kept.

## Runtime upgrade of a shown conversation (2026-09-29)

When the backend reinstalls the terminal runtime (new code version), the shown
conversation is reopened through the newly installed `__cccOpenNativeTerminal`
(`reopen()`), which disposes the old view and mounts the same record with the new
session code. The composer draft lives in sessionStorage and survives. Views from
older runtimes without `reopen()` fall back to `remount()`.
