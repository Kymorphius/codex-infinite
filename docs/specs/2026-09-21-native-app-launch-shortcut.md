# Native application launch shortcut

The injected lower-left control strip displays `原生` immediately to the left of
`重启`. Clicking it explicitly asks the loopback control service to activate the
installed native Codex application. It does not restart, close, reconfigure, or
inject the currently open dedicated console.

The request is `POST /api/native-app/launch`, restricted to the exact dashboard
origin and an empty JSON object. It takes no app path, command, profile, or
environment from the renderer. On macOS the service invokes LaunchServices with
the configured primary native profile, distinct from the dedicated console
profile; on Windows it starts the resolved installed package.
The endpoint returns acceptance only; it does not claim that a visible window has
finished loading. A failed request leaves the current console unchanged and shows
an explanatory button tooltip.

Tests verify button ordering and request shape, exact-origin/empty-body endpoint
validation, and that the launch plan contains only the configured native profile
and no wrapper, CDP, or environment arguments. `npm run check` and `npm test`
cover the complete change.
