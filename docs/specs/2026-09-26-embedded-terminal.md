# Embedded local terminal

## Goal and scope

Provide a real interactive terminal inside the console, including native Claude
CLI, without depending on Agent SDK feature parity. The first delivery is local
to this device. Shell and Claude sessions use a PTY, retain their process across
module switches and page reconnects, and end when explicitly closed or when the
console backend shuts down. Existing terminal processes are not adopted.

## User flow

The Terminal module offers a working-directory field, New terminal and Claude
CLI actions, independent session tabs, connection/exit status and Close session.
Opening the module starts no process. New terminal opens the user's login shell;
Claude CLI invokes the constant `claude` command through that shell so existing
user configuration and shell functions apply. Input, Ctrl-C, cursor keys, terminal
resizing, Unicode and bracketed paste work through xterm.js and node-pty.
Switching modules or reloading reconnects without rerunning startup commands.
Closing a running session requires an in-product confirmation because it ends
its process. Closed/failed sessions and unavailable CLI/dependencies show errors.
Cleanup covers the live PTY and discoverable attached child processes. Commands
the user intentionally detaches (for example nohup after the shell has exited)
retain normal terminal semantics and are not tracked or killed globally.

## Boundaries and contracts

- New pure terminal contract, PTY service/process adapter, HTTP handler and
  WebSocket adapter; main remains composition and lifecycle only.
- POST `/api/terminal/list` with `{}` returns `{sessions, defaultCwd}`.
- POST `/api/terminal/create` accepts `{cwd, kind, cols, rows}`, where kind is
  `shell` or `claude`, and returns `{session}`.
- POST `/api/terminal/close` accepts `{id}` and returns `{ok:true}`.
- Session summaries contain id, title, cwd, kind, status, cols, rows and exitCode.
- `/api/terminal/socket?id=...` upgrades only after exact Origin and Host checks.
  Server frames: `{type:'ready',session,replay}`, `{type:'data',data}`,
  `{type:'exit',exitCode}` and `{type:'error',message}`. Client frames are
  `{type:'input',data}` and `{type:'resize',cols,rows}`.
- One connected browser controls a terminal at a time; reconnecting replaces
  the old transport without killing the PTY. No automatic replay of user input.
- Bound session counts, frame/input sizes, output replay and slow-client queues.
  Replay is memory-only and bounded; a truncation indicator explains lost history.
  Bound the browser's unparsed xterm output too; excess output pauses display with
  an explicit reconnect action, without silently claiming that the process ended.
- All HTTP terminal endpoints require exact dashboard Origin and JSON, including
  listing. No cross-node shell endpoint, external listener or browser credentials.
- Spawn only server-selected shell/constant Claude command with validated existing
  absolute cwd. Preserve the real user HOME, and pass a small shell environment
  allowlist rather than the console's infrastructure secrets. Do not read auth
  stores or log/persist terminal contents. User-invoked commands may naturally
  print arbitrary text, including secrets, just as a local terminal can.
- Browser dependencies are pinned npm packages, served by exact asset allowlists,
  with no CDN, node_modules directory exposure, output HTML, automatic hyperlinks,
  or terminal-driven clipboard write integration.

## Acceptance

- Contract/service/transport tests: invalid origin/host/body/size/directory, PTY
  creation/input/resize/exit/close, reconnect without respawn, single controller,
  bounded replay and shutdown cleanup.
- Run `npm run check` and `npm test`; report pre-existing failures separately.
- Exercise the rendered panel with a real PTY: shell output, Unicode, resize,
  Ctrl-C, second session, module switch/reconnect and close; open native Claude
  CLI to its interactive interface without sending a model task.
- Service restart ends these owned terminal sessions; browser reconnect preserves
  them only while the backend remains running. Remote-terminal delivery is outside
  this local feature.

## Verification results

- `npm run check`: passed (624 JavaScript files; structure check 663 files).
- `npm test`: 1201 passed, zero failed/skipped, including real PTY and browser
  transport regression coverage. Independent frontend review reran 12/12 tests.
- Rendered in the Codex in-app browser: Chinese shell output, automatic terminal
  sizing (`stty size`), Ctrl-C followed by another command, independent tabs,
  module switching, same-session/selected-tab restoration after page reload,
  close confirmation and tab removal all passed.
- The formal loopback service on port 47831 was restarted without restarting the
  desktop application. Native Claude Code 2.1.283 opened using the user's native
  profile in this project and its `/help` interactive screen rendered correctly.
  No model task was submitted. The temporary preview server and its PTYs were
  stopped; a ready Claude terminal remains open in the formal panel for the user.
- Native node-pty macOS helper permissions required a targeted installation fix;
  `postinstall` now reapplies the executable bit only to the known package helper.
- Actual desktop verification covered this macOS host. Windows launch/path
  handling is implemented; other-device installation and native UI acceptance
  are not claimed by this local delivery.
