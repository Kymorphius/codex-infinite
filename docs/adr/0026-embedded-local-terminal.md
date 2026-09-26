# 0026: Own local PTY sessions behind the console origin

The user requested an embedded terminal to retain native Claude CLI interaction,
including features not exposed through Agent SDK. Use xterm.js with node-pty and
an exact-origin WebSocket on the existing loopback server. This is a separate
local terminal capability; native Codex still owns Codex conversations and the
session index stays read-only. Do not route terminal bytes through Codex message
adapters or expose an unsigned remote shell through the node federation.

The console owns only PTYs it creates. Browser detachment leaves them alive;
explicit close and backend shutdown terminate them. Buffers are bounded and
memory-only. A single active connection owns input/resize per session. The service
does not inspect credential stores or forward its infrastructure environment.
Terminal output is user/process content, may include incidental secrets, and is
shown only through the exact-origin local connection without logging or disk
storage, consistent with the execution-content distinction in ADR 0008.

The native dependency introduces per-platform installation requirements. Pin it
in the lockfile, load it only when a terminal is requested, and report startup
failure in the panel without breaking the existing console. No structure budget
increase is needed.
