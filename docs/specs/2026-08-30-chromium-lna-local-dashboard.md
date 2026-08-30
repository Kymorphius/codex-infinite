# Chromium Local Network Access compatibility

## Status

Implemented and verified on 2026-08-30.

## Problem

The upgraded desktop runtime uses Chromium 151. Its Local Network Access (LNA)
policy classifies an `app://-` subframe navigation to the wrapper's
`http://127.0.0.1:47831` dashboard as a secure-context request to loopback and
reports `localNetworkAccessRequestPolicy: PermissionBlock`. The server returns
HTTP 200, but Chromium replaces the embedded session center with a blocked-
content error page. After satisfying LNA, the current native renderer still
rejects the frame with `ERR_BLOCKED_BY_CSP` because its explicit `frame-src`
directive does not include the loopback dashboard.

The application cannot request the browser permission from the opaque `app://-`
origin through ordinary web APIs, and the desktop host does not expose an LNA
permission handler to the injected renderer.

## Goals

- Restore the embedded dashboard, including the session center, on Chromium 151.
- Keep HTTP, CDP, and dashboard data bound to `127.0.0.1`.
- Keep every dashboard mutation protected by the exact dashboard origin.
- Scope the compatibility change to the dedicated wrapper process and profile;
  never change the normal Codex application or system browser.
- Make stale wrapper processes fail closed so the compatibility mode cannot be
  silently omitted after an upgrade.

## Non-goals

- Allowing LAN hosts, wildcard listeners, or remote dashboard origins.
- Disabling CORS, exact-origin mutation checks, sandboxing, or credential
  isolation.
- Changing normal Codex, Chrome, or operating-system network permissions.

## Design

The dedicated wrapper launcher passes
`--disable-features=LocalNetworkAccessChecks` to its own ChatGPT/Codex process.
This disables the Chromium permission gate that cannot be satisfied by the
embedded `app://-` origin. The wrapper signature includes a compatibility
version so an older process is rejected and must be restarted.

The injector enables `Page.setBypassCSP` only on the selected dedicated Codex
main-page target. Chromium applies this setting reliably to iframe navigation
only when the renderer document is created under the bypass, so the injector
registers its new-document scripts first and performs one native `Page.reload`
the first time compatibility is enabled. A new-document marker prevents a
background service restart from causing another reload. A real later renderer
navigation runs the registered injection scripts again under the same target-
scoped bypass.

The injector never edits `ChatGPT.app` or serializes/replaces the live React
document. The fixed dashboard URL remains the only URL created by the injected
workspace code.

LNA relaxation applies to renderer requests in the dedicated wrapper process;
CSP bypass applies to the dedicated main-page target. Their compensating
controls are the existing loopback-only listeners, the fixed dashboard URL,
strict static-asset allowlist, exact-origin mutation checks, bounded request
bodies, credential isolation, and the dedicated Chromium profile.

## Verification

- Unit-test that launches include the exact single feature-disable switch and
  that the wrapper signature changes.
- Unit-test that the target-scoped bypass precedes exactly one initial reload
  and that a marked compatible document is not reloaded again.
- Run `npm run check` and `npm test`.
- Restart only the dedicated wrapper application.
- Observe a child frame for `http://127.0.0.1:47831/?module=sessions` in the live
  CDP frame tree and verify its document title/content instead of the Chromium
  blocked-content page.
- Verify dashboard health remains loopback-only and the session API loads.

## Rollback

Remove the target CSP preparation, launcher flag, and compatibility wrapper
signature. On Chromium 151 this intentionally returns the embedded workspace
to the blocked state; the dashboard remains reachable as a top-level loopback
page.
