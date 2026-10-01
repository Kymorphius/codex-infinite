# Router supervision in the dashboard

- Status: accepted
- Owner: matrix
- Date: 2026-10-01
- Related ADRs: none

## Problem

The dashboard depends on the local Codex Router (`io.github.codex-router`,
proxy `127.0.0.1:4202`) for model routing, Claude companions and turn state.
On 2026-10-01 at 05:59 the router's LaunchAgent was booted out of launchd
(clean "Shutting down" in `router.log`, tray agent unloaded too). launchd's
`KeepAlive` only restarts a loaded job, so the router stayed down for ~17 h
and nothing in the dashboard showed it. Recovery required a manual
`launchctl bootstrap`.

## Goals

- The dashboard shows the router's state (running / degraded / stopped /
  disabled / not installed) in the top bar, refreshed every 15 s.
- When the LaunchAgent is installed and enabled but not loaded, the dashboard
  bootstraps it automatically, at most once per 5 min and 3 times per hour.
- The user can manually start (stopped) or restart (loaded but unhealthy)
  the router from the dashboard after confirmation.
- Router health appears as a `codex-router` check in `/api/diagnostics`.

## Non-goals

- Owning the router process, code or install (it stays a separate product in
  `~/.local/share/codex-router` with its own launchd agents).
- Automatic `kickstart -k` of a loaded router: that kills in-flight turns, so
  it is manual only.
- Starting a router that is disabled or uninstalled; `launchctl disable` /
  `codex-router uninstall` remain the way to keep it off.
- Restarting the dedicated window after a router catalog change.
- Windows/Linux service managers (reported as `unknown`, no actions).

## User experience

A pill next to "仅本机" in the top bar: `Router` with a colored dot and a
short label (运行中 / 异常 / 已停止 / 已停用 / 未安装 / 未知).

The native ChatGPT window shows the same state as an icon button at the
bottom of the left sidebar rail, above the profile button, styled like the
native rail buttons, with a colored corner dot and the same tooltip (the
sidebar header row already overflows at normal widths). It talks to the backend only through the CDP binding
`__codexControlConsoleRouterStatusBridge` (`{"kind":"status"|"repair"}`),
polls every 15 s while visible, and repairs after `window.confirm`. The tooltip
lists version, launchd state and the last repair. When a repair action is
available the pill is a button; clicking asks for confirmation (restart text
warns that running turns will be interrupted), posts the repair, and shows
the result as a toast. Polling pauses while the page is hidden.

## Contracts and data

`GET /api/router/status` →

```json
{ "status": "ready|degraded|stopped|disabled|not-installed|unknown",
  "reason": "string|null", "repair": "bootstrap|kickstart|null",
  "service": { "label": "...", "installed": true, "enabled": true, "loaded": true, "state": "running", "pid": 1 },
  "health": { "reachable": true, "ok": true, "version": "0.6.0", "degraded": [], "activeCount": 0 },
  "autoRepair": true, "checkedAt": "ISO", "lastRepair": { "at": "ISO", "action": "bootstrap", "trigger": "auto|manual", "ok": true, "message": null } }
```

`POST /api/router/repair` with body `{"confirm":true}` → 202 with the status
above. Nothing is persisted; repair history is process-local.

Config: `routerLaunchAgentLabel` (`io.github.codex-router`),
`routerLaunchAgentPath` (`~/Library/LaunchAgents/<label>.plist`),
`routerAutoRepair` (env `CODEX_CONTROL_ROUTER_AUTO_REPAIR=0` turns it off).

## Design and ownership

- `src/router-supervision-policy.mjs` — pure: derive status and available
  repair from service + health facts; auto-repair throttle decision.
- `src/router-launchd-adapter.mjs` — macOS adapter: `launchctl print`,
  `print-disabled`, `bootstrap`, `kickstart -k` on the fixed label, plus the
  unauthenticated `GET <routerOrigin>/health` probe, normalized.
- `src/router-supervisor.mjs` — application service: periodic probe, auto
  repair through the policy, manual repair, snapshot for HTTP/diagnostics.
- `src/router-supervision-http.mjs` — loopback transport.
- `public/features/runtime/router-status.js` — top-bar pill.
- `src/native-router-status.mjs` — native header button, its presenter and
  the extra-binding descriptor installed by `CodexInjector`.
- `src/main.mjs` wires and starts/stops the supervisor;
  `RuntimeDiagnosticsService` reads its snapshot.

## Security and privacy

- Health probe targets only the configured `127.0.0.1` router origin and
  needs no caller secret; the caller secret is never read here.
- Only `version`, `ok`, `degraded` names and the active count leave the
  probe; session names and models in `activity` are dropped.
- Mutations require the exact dashboard origin, JSON content type and
  `{"confirm":true}`. launchctl runs with argv (no shell) against the fixed
  label and plist path from config.
- Disabled or missing agents are never enabled, written or started.

## Rollout and rollback

Active on next console restart. Set `CODEX_CONTROL_ROUTER_AUTO_REPAIR=0` to
keep display and manual repair without auto start. Reverting the change
removes the pill and endpoints; the router is unaffected.

## Acceptance criteria

- [ ] Installed + enabled + not loaded → `stopped`, auto bootstrap after two
  consecutive observations, throttled.
- [ ] Disabled or missing plist → no auto or manual action.
- [ ] Loaded but `/health` unreachable or not ok → `degraded`, manual
  `kickstart` only.
- [ ] Repair endpoint rejects foreign origin, wrong content type, missing confirm.
- [ ] Health payload is reduced to the documented fields.
- [ ] Top-bar pill renders each status and confirms before repair.

## Verification plan

- Unit: policy, adapter parsing/commands with fake exec, supervisor throttle,
  HTTP handler, UI pill with fake DOM/fetch.
- Integration: live `GET /api/router/status` against the running router.
- Real UI: pill visible in the dashboard top bar.
- Structure and regression: `npm run check`, `npm test`.

## Shipped deviations

- `src/router-supervision-runtime.mjs` assembles adapter + supervisor so
  `src/main.mjs` stays inside its byte budget.
- The `codex-router` diagnostics check is present only when a supervisor is
  wired, so callers without one keep their previous overall status.
- `src/startup-log.mjs` takes the startup log lines out of `src/main.mjs` to
  make room for the native binding wiring.
- `/features/terminal/mirror.js` (from 84bbe79) was never allowlisted, so the
  dashboard module graph failed to load; it is now served and
  `test/static-asset-imports.test.mjs` guards every reachable import.
- The pill uses `aria-disabled` instead of `disabled` so its tooltip still
  shows in Chromium when no repair is available.
