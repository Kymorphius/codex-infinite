# Native theme continuity

## Context

The embedded control console and unified remote conversation currently force a light palette. When Codex is using its dark appearance, opening a console workspace produces a full-window white flash and leaves the remote conversation visually disconnected from the native shell.

## Goals

- Detect the visible native Codex surface as light or dark when opening an embedded workspace.
- Pass only that normalized theme choice to the loopback dashboard.
- Apply the theme before the dashboard UI paints so loading and content do not flash between palettes.
- Give the full console and the unified conversation a restrained dark palette aligned with native Codex surface, border, text, and composer contrast.
- Keep standalone dashboard pages responsive to the operating-system preference when no host theme is supplied.

## Non-goals

- Reading or modifying Codex settings or profile storage.
- Depending on private React state, CSS class names, or a particular Codex release.
- Synchronizing arbitrary colors, accent themes, or high-contrast accessibility settings in this increment.

## Design

The injection derives a normalized `light` or `dark` value from the host document's computed color scheme and visible background luminance, with `prefers-color-scheme` as a fallback. The fixed loopback dashboard URL receives that value as a bounded `theme` query parameter. Overlay, iframe, and loading surfaces use the same palette immediately.

A small first-party dashboard bootstrap reads only `light` or `dark`, falls back to `prefers-color-scheme`, and sets `data-theme` on the document root before feature scripts run. A final theme stylesheet overrides shared surfaces across every dashboard module and the unified conversation. No browser credential, project, session, or host state is transmitted.

## Safety

- The dashboard remains loopback-only.
- The theme parameter accepts only two fixed values.
- No new cross-origin mutation or message contract is introduced.
- Theme detection uses computed visual properties only.

## Acceptance criteria

- [x] A dark native Codex window opens the dashboard with a dark loading surface and dark content.
- [x] A light native Codex window keeps the existing light content.
- [x] The remote conversation background, text, user bubble, process rows, header, and composer use coherent dark contrast.
- [x] Session, task, priority, state, and Zotero surfaces have usable dark backgrounds and controls.
- [x] A standalone dashboard follows `prefers-color-scheme` when the query parameter is absent.
- [x] Static asset, injection, syntax, structure, and unit tests pass.

## Verification

- Unit-test that the injection carries a normalized theme and does not use Codex private state.
- Verify the theme bootstrap is allowlisted as an exact static asset.
- Inspect the real embedded conversation under a forced dark host query and confirm no white conversation surface remains.
