# Wrapper SQLite sidecar links

- Status: shipped
- Owner: Codex Control Console
- Date: 2026-09-01
- Related ADRs: none

## Problem

The isolated wrapper shares `state_5.sqlite` with the ordinary Codex home. Its
`-shm` and `-wal` sidecars are dynamic: they may be absent while the wrapper is
prepared and appear later when SQLite opens the database. Preparation currently
skips absent source entries, allowing the wrapper to create unrelated regular
sidecar files. A later restart then correctly refuses those regular files, but
the Windows node remains offline until they are safely migrated.

## Goals

- Keep the SQLite database and both sidecars in one shared file family.
- Create sidecar links even when their source targets do not yet exist.
- Accept the same links after their targets appear or disappear.
- Continue refusing regular files or links that point anywhere else.
- Repair the existing Windows node with a recoverable backup and verify its
  loopback dashboard and federated snapshot.
- Pass the isolated Chromium profile through both the command-line switch and
  the desktop package's explicit profile environment contract.
- Do not interrupt the Windows desktop bootstrap navigation while preparing
  the target-scoped CSP bypass.

## Non-goals

- Deleting or merging unknown SQLite files automatically during startup.
- Changing the ordinary Codex database, profile, or listener boundaries.
- Exposing the Windows dashboard outside `127.0.0.1`.

## Design

`state_5.sqlite-shm` and `state_5.sqlite-wal` are required shared-link entries,
even while absent in the source home. Link validation compares the resolved
declared link target with the expected source path and therefore works for a
dangling link. All other allowlisted entries retain the existing source-exists
requirement.

An existing regular wrapper sidecar remains a hard error. Operational repair
moves the two known wrapper-side files into a timestamped backup directory,
creates exact links to the ordinary Codex sidecars, and starts the existing
scheduled task. No ordinary Codex file is removed or replaced.

Current Windows desktop builds inspect `CODEX_ELECTRON_USER_DATA_PATH` during
bootstrap before importing the main application. The launcher sets it to the
same dedicated profile already carried by `--user-data-dir`. This prevents the
packaged app from selecting the dedicated Chromium profile at native startup
and then attempting a late switch back to the ordinary profile.

The Windows desktop first loads its packaged `file:` bootstrap and then
navigates the window to `app://-/index.html`. Reloading the CDP target while
that navigation is in flight aborts the application URL, closes the window,
and leaves only the built-in `Failed to start` fallback. Windows therefore
enables target-scoped CSP bypass without `Page.reload`; other platforms retain
the established reload behavior. The injector already supports this mode, so
the platform decision belongs in normalized configuration rather than in CDP
or UI code.

SQLite may unlink the pre-created sidecar links and recreate regular `-shm`
and `-wal` files while the dedicated Windows desktop is running. The desktop
can outlive a control-console service restart, so startup first verifies the
existing CDP owner by loopback endpoint, dedicated profile, and wrapper
signature. Only for that exact attached runtime may wrapper preparation accept
the two known regular sidecars as live runtime files. A cold start, an unknown
CDP owner, a stale signature, or any other regular shared entry remains a hard
error. This lets the controller reattach without killing a healthy native task
while preserving the cold-start safety boundary.

## Acceptance criteria

- [x] Preparation creates both sidecar links before their source files exist.
- [x] A second preparation succeeds after source sidecars appear.
- [x] A regular wrapper sidecar is still rejected without mutation.
- [x] Syntax, structure, and complete tests pass.
- [x] Windows listens on `127.0.0.1:47831` and returns a valid node snapshot.
- [x] The dedicated Windows desktop keeps a page target on `127.0.0.1:9231`
  without showing `Failed to start`.
- [x] Windows config disables the bootstrap-time CSP reload while non-Windows
  config retains it.
- [x] The Mac sidebar reports `Windows Desktop` as connected.
- [x] Restarting only the Windows controller reattaches to the verified
  dedicated desktop even when SQLite has materialized regular live sidecars.
- [x] The same regular sidecars are still refused when no verified dedicated
  desktop is already running.
