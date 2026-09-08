# Top module tab bar

- Status: superseded by `2026-09-03-conversation-workspace-tabs.md`
- Owner: Codex Control Console
- Date: 2026-09-03
- Related ADRs: none

## Problem

The six primary modules are exposed as a row below the page title. Although the
controls switch modules, their placement and underline-only treatment read as a
secondary navigation row rather than a persistent top-level tab bar. On long
pages the module switcher also scrolls out of view.

## Goals

- Present the six module destinations as the first, persistent row in the console.
- Give the active destination a clear tab-shaped selected state in light and dark themes.
- Preserve horizontal access to every tab on narrow viewports.
- Expose tab selection to assistive technology and support Arrow, Home, and End keyboard navigation.

## Non-goals

- Adding, removing, or renaming modules.
- Changing module data loading, server routes, native-frame messages, or permissions.
- Persisting additional user preferences.

## User experience

The module tabs sit at the top of the page and remain visible while the user
scrolls. Selecting a tab continues to show its existing panel and title. The
active tab uses a filled surface and `aria-selected=true`. When a tab has focus,
Left/Right Arrow moves to the adjacent tab, Home moves to the first tab, and End
moves to the last tab; focus wraps at both ends. On small screens the row scrolls
horizontally without shrinking or wrapping tab labels.

## Contracts and data

None. Existing module keys, URL input, application state, HTTP contracts, and
parent-frame message contracts are unchanged.

## Design and ownership

`public/index.html` owns the tab-list markup. `public/styles/base.css`,
`public/styles/theme.css`, and `public/styles/responsive.css` own its shared,
dark-theme, and narrow-layout presentation. `public/core/navigation.js` owns
selected-state synchronization and keyboard interaction. Domain and transport
modules remain independent of the DOM.

## Security and privacy

No trust boundary, credential, origin, network, filesystem, or destructive
behavior changes.

## Rollout and rollback

The bar replaces the visual placement of the existing module switcher without a
flag or migration. Roll back the markup order, tab styles, and keyboard handler
to restore the previous below-title navigation.

## Acceptance criteria

- [x] The module tab bar is the first visible console row and stays at the top while scrolling.
- [x] All six existing modules remain selectable by pointer.
- [x] The selected tab exposes both a visible selected state and `aria-selected=true`.
- [x] Arrow, Home, and End keys move focus and activate the expected tab.
- [x] Narrow screens retain access to all tabs through horizontal scrolling.
- [x] Light and dark themes use the shared console color tokens.

## Verification plan

- Unit: navigation tests cover selected-state synchronization and keyboard movement.
- Integration: existing static-shell and module navigation tests remain green.
- Real UI: inspect desktop and narrow viewports, switch tabs, and verify sticky behavior.
- Structure and regression: run `npm run check` and `npm test`.

## Shipped deviations

The module bar remains as secondary feature navigation below the console title.
A separate Chrome-style workspace bar now owns open conversation tabs.
