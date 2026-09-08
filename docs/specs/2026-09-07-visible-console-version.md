# Visible Codex Infinite version

- Status: implemented
- Owner: Codex Control Console
- Date: 2026-09-07
- Related ADRs: none

## Problem

The dedicated native window exposes several custom entry points, but the user
cannot tell which Codex Infinite build is installed without inspecting source or
renderer globals. This makes cross-device rollout confirmation unnecessarily
opaque.

## Goals

- Show the installed product version immediately left of the dashboard's `重启` button.
- Show the same version immediately left of the native bottom `重启` shortcut.
- Use the package version as the single displayed source of truth.
- Keep the badge stable across native sidebar redraws and service refreshes.

## Non-goals

- Display every individual injection-module version.
- Add a remote version negotiation protocol or persisted version state.
- Change native Codex or ChatGPT application version reporting.

## User experience

The dashboard top bar shows a subdued `v<package version>` label immediately
left of `重启`. The native sidebar entries remain unchanged. The label has an
accessible name that identifies it as the Codex Infinite version. The native
bottom shortcut repeats the label immediately left of its `重启` button so the
installed version remains visible without opening the dashboard.

## Contracts and data

The displayed value comes from `package.json#version`. No network contract,
storage format, or migration changes.

## Design and ownership

`src/static-assets.mjs` owns trusted shell composition and replaces one fixed
version marker with the validated package version. `public/index.html` and
`public/styles/base.css` own dashboard placement and presentation.
`src/native-sidebar-restart.mjs` owns the native shortcut copy and reserves
enough adjacent space for the version-and-restart group. No adapter dependency changes.

## Security and privacy

The static package version contains no user or device data. Existing loopback,
origin, credential, and filesystem boundaries are unchanged.

## Rollout and rollback

Bump the main injection version once to remove the earlier sidebar placement,
then restart the control service. Rollback removes the shell marker and label
without data migration.

## Acceptance criteria

- [x] The dashboard top bar visibly shows the package version left of `重启`.
- [x] The native `控制台` sidebar entry no longer shows a version.
- [x] Exactly one accessible version label exists in the assembled shell.
- [x] The deployed MacBook Pro visibly reports the expected placement.
- [x] The native bottom version is visible immediately left of its `重启` shortcut.
- [x] Full checks and tests pass.

## Verification plan

- Unit: shell composition validates and replaces the fixed version marker.
- Integration: request the assembled dashboard and confirm exactly one version label.
- Real UI: inspect the MacBook Pro dashboard and native sidebar after restart.
- Structure and regression: run `npm run check` and `npm test`.

## Shipped deviations

None.
