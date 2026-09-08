# Native attention sticky headings

- Status: shipped
- Owner: Codex Control Console
- Date: 2026-09-01
- Related ADRs: none

## Problem

Long conversation lists can scroll the active attention-category heading out of
view. The user then loses the context of whether visible conversations belong
to `现在`, `等待`, `本周`, or `待整理`, recreating the sense of being submerged
by the sidebar.

## Goals

- Keep the current attention-category heading pinned to the top of the native
  sidebar scroll viewport while its section remains current.
- Let the following attention heading naturally replace the previous one.
- Preserve the native heading appearance without an injected background,
  pseudo-element surface, border, or shadow (user correction, 2026-09-05).
- Keep eight pixels of breathing room above the pinned title.
- Preserve native ordering, toggle behavior, drag/drop, and section ownership.

## Non-goals

- Pinning project, device, built-in ChatGPT, or unrelated custom sections.
- Reordering attention sections or changing their contents.
- Persisting new state or replacing native scroll behavior.

## Design

`src/native-attention-sticky.mjs` installs one scoped style element and marks
only native section-title wrappers whose exact normalized text is `现在`,
`等待`, `本周`, or `待整理`. CSS sticky positioning remains constrained by
each native section, producing the standard handoff when the next section
arrives. The injection changes only positioning and stacking; native styles own
the heading appearance. A mutation observer reapplies markers after native
React rerenders. The 2026-09-05 revision removes the earlier opaque pseudo-element
mask, which appeared as a separate rectangle on Windows. It also removes the
old window-focus marker and listeners during live upgrade. The native surface
may remain transparent while sticky; no replacement mask is synthesized.

Both the dedicated and primary native injectors install the behavior. The
feature owns only its style element and marker attributes; it does not move or
wrap native nodes.

## Safety and rollback

No data crosses the injection boundary and no network or mutation contract is
added. Removing the injection wiring, style node, and marker attributes fully
removes the behavior on reload.

## Acceptance criteria

- [x] Each attention heading sticks to the sidebar viewport top while scrolling
  within its section.
- [x] The next attention heading replaces the previous heading without overlap.
- [x] Heading appearance follows native styles in dark/light and focused/unfocused states.
- [x] The sticky title keeps its eight-pixel top offset.
- [x] The injection adds no background, pseudo-element mask, border, or shadow.
- [x] Non-attention sections are not marked or pinned.
- [x] Native nodes are not moved, wrapped, or reordered.
- [x] Both native injector paths install the behavior.
- [x] `npm run check` and `npm test` pass without a structure-budget increase.

## Verification plan

- Unit/source: exact heading allowlist, scoped style/marker ownership, mutation
  recovery, and absence of native-node movement.
- Integration: dedicated and primary injectors install the source.
- Real UI: programmatically scroll within a populated attention section and
  compare heading/scrollport geometry before and after the sticky threshold.
- Visual: inspect seamless background, width, top padding, and handoff at the
  next section.

## Shipped deviations

None.

## Shipped evidence

- Live inspection found all four and only the four attention headings marked:
  `现在`, `等待`, `本周`, and `待整理`; the remote-device area was unmarked.
- With the sidebar scroll position placed inside `现在`, its natural position
  would have been above the viewport. The title remained at 124px while the
  scrollport began at 115px, preserving eight pixels of intended breathing room
  plus native subpixel alignment.
- The first opaque panel-token implementation rendered at `(35,35,35)` against
  the surrounding `(41,41,41)` desktop sidebar and created the reported inset
  groove. A web-surface composition removed the difference in CDP screenshots
  but remained dark after native desktop vibrancy was applied. The shipped
  surface therefore uses the native opaque tertiary surface token directly.
- Scrolling toward `本周` moved `等待` upward as `本周` approached the top;
  their measured positions remained separated, confirming native section-bound
  handoff without overlap.
- The native heading box remained inset from 8px to 305.1px, while its owned
  background extended from 0px to the complete 313.1px scrollport width. Visual
  inspection confirmed the title itself is transparent and the sole masking
  pseudo-element resolves to the desktop surface `rgb(40,40,40)`, matching the
  `(41,41,41)` display-captured sidebar after color management. It has zero
  border widths and no box shadow. Rows do not leak through the top padding,
  and native typography is unchanged.
- A later unfocused-window capture showed the fixed tertiary mask at
  `rgb(40,40,40)` against the dimmed sidebar at `rgb(34,34,34)`. The focus-aware
  mask now uses the native `--color-background-panel` token while unfocused and
  restores `--color-surface-tertiary` on focus.
- Syntax and structure checks passed for 176 and 194 files respectively with
  zero frozen debt. All 252 tests passed.
