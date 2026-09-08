# Chromium Local Network Access compatibility

## Status

Implemented on 2026-08-30 and extended for Chromium 152 on 2026-09-03.

## Problem

The upgraded desktop runtime first used Chromium 151. Its Local Network Access (LNA)
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

Chromium 152 separates iframe navigation enforcement into
`LocalNetworkAccessForSubframeNavigations`. Disabling the umbrella
`LocalNetworkAccessChecks` feature selects Chromium's legacy Private Network
Access navigation path, which still blocks the frame. The wrapper must leave
the umbrella feature enabled and disable only the subframe-navigation feature.
Chromium 152 also reports the
iframe `allow="local-network-access"` token as unrecognized; that token does not
grant the required permission and is omitted.

## Goals

- Restore the embedded dashboard, including the session center, on Chromium 151
  and 152.
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

The dedicated wrapper launcher passes one exact feature-disable switch,
`--disable-features=LocalNetworkAccessForSubframeNavigations`, to its own
ChatGPT/Codex process. This leaves Chromium's current LNA implementation active
while disabling only its iframe-navigation permission gate, which cannot be
satisfied by the embedded `app://-` origin. Disabling the umbrella LNA feature
is intentionally avoided because Chromium 152 then falls back to the legacy
Private Network Access navigation check. The wrapper signature includes a
compatibility version so an older process is rejected and must be restarted.
The injected iframe retains only the supported clipboard permissions and does
not advertise the ineffective `local-network-access` token.

The injector enables `Page.setBypassCSP` only on the selected dedicated Codex
main-page target. It reasserts this idempotent target setting on every bounded
injector synchronization because Chromium can replace the renderer behind an
unchanged target identifier and discard the prior CDP session state. Script
registration and compatibility reload bookkeeping remain one-time operations.
Chromium applies the setting reliably to iframe navigation only when the
renderer document is created under the bypass. Every supported host therefore
registers its new-document scripts first and performs one native `Page.reload`
the first time compatibility is enabled. This includes Windows as of Chromium
152, where reasserting the target setting against an already-created parent
document still leaves its parsed `frame-src` policy active. A new-document
marker prevents a background service restart from causing another reload. A
real later renderer navigation runs the registered injection scripts again
under the same target-scoped bypass.

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
- Unit-test that the iframe permission policy omits the unsupported
  `local-network-access` token.
- Unit-test that the target-scoped bypass precedes exactly one initial reload
  and that a marked compatible document is not reloaded again.
- Unit-test that repeated synchronization reasserts the target-scoped bypass
  without repeating script registration or the compatibility reload.
- Run `npm run check` and `npm test`.
- Restart only the dedicated wrapper application.
- Observe a child frame for `http://127.0.0.1:47831/?module=sessions` in the live
  CDP frame tree and verify its document title/content instead of the Chromium
  blocked-content page.
- Verify dashboard health remains loopback-only and the session API loads.

## Rollback

Remove the target CSP preparation, launcher flags, and compatibility wrapper
signature. On Chromium 151/152 this intentionally returns the embedded
workspace to the blocked state; the dashboard remains reachable as a top-level
loopback page.
