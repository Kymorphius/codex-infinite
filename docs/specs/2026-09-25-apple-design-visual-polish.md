# Apple Design review follow-up: contrast and responsive density

- Status: implemented
- Owner: Codex
- Date: 2026-09-25
- Related ADRs: none

## Problem

The Apple Design review found three visible issues in the console: tertiary dark-theme labels use `#7f7f85` and fall below WCAG AA contrast for small text; empty dispatch columns retain large fixed minimum heights and push results below the first viewport; and module tabs can overflow at widths between the mobile breakpoint and desktop without a scroll affordance.

## Goals

- Meet at least 4.5:1 contrast for tertiary text on supported dark surfaces.
- Let empty dispatch columns use less vertical space while preserving the normal height of columns containing tasks.
- Make every module tab reachable at compact and intermediate window widths, with a visible horizontal scroll affordance where the viewport clips tabs.
- Preserve existing module behavior, navigation order, and light-theme appearance.

## Non-goals

- Redesign the navigation as a sidebar or change the module hierarchy.
- Change persisted data, APIs, routing, or user preferences.

## User experience

Use a lighter tertiary text token in dark appearance. In dispatch boards, compact only columns containing the empty-state element; populated columns retain their current minimum height. At widths up to 1100px, allow horizontal scrolling in the module navigation, keep its scrollbar visible, and hide the trailing descriptive caption to protect tab space.

## Contracts and data

None. This change is limited to CSS presentation.

## Design and ownership

`public/styles/theme.css` owns the dark-theme token. `public/styles/tasks.css` owns dispatch board density. `public/styles/responsive.css` owns width-dependent navigation behavior. No runtime module changes are planned.

## Security and privacy

No changes to network, credentials, data access, or filesystem behavior.

## Rollout and rollback

Static CSS loads with the existing console. Revert the focused CSS and this specification to roll back.

## Acceptance criteria

- [x] Dark tertiary text meets 4.5:1 against `#1b1b1d`, `#202022`, and `#29292b` (measured 5.56:1, 5.26:1, and 4.69:1).
- [x] Empty dispatch columns compact, while populated columns retain their current minimum height (confirmed in the running native console).
- [x] At a width between 721px and 1100px, all module tabs remain horizontally reachable and scrolling is indicated (confirmed at 800px; 11 tabs, visible scrollbar).
- [x] Existing module navigation and dispatch regression tests pass (`npm test`: 963 tests passed).
- [x] The running console visibly loads the new usage tab and the updated layout after reload.

## Verification plan

- Unit: contrast calculation and existing navigation and dispatch regression tests.
- Integration: `npm run check` and `npm test` passed.
- Real UI: inspected the current native console after reload, the 800px compact-width browser preview, and the native dispatch board after scrolling to its results area.
- Structure and regression: inspect the focused diff; do not add runtime or data changes.

## Shipped deviations

None.
