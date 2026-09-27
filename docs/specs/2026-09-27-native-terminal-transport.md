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
