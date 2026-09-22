# Native attention section flow

- Status: revised 2026-09-22
- Owner: Codex Control Console
- Date: 2026-09-01
- Related ADRs: none

## Problem

The former implementation made only `现在`, `等待`, `本周`, and `待整理`
sticky. That special positioning diverged from every other native section and
made some sections appear to expand upward when toggled near the viewport edge.

## Goals

- Let every native section use the same normal document flow and expansion
  direction.
- Remove legacy sticky styles, markers, observers, and focus listeners during a
  live upgrade.
- Preserve native ordering, toggle behavior, drag/drop, and section ownership.

## Non-goals

- Reimplementing native collapse animation or scroll behavior.
- Reordering attention sections or changing their contents.
- Persisting new state.

## Design

`src/native-attention-sticky.mjs` remains wired into both injector paths as a
bounded retirement shim. It disconnects an existing observer, removes the
legacy style and marker attributes, clears the former focus hooks, and installs
no replacement behavior. Keeping the cleanup injection allows already-open
windows to upgrade without requiring stale DOM state to survive until restart.

Both the dedicated and primary native injectors install the behavior. The
feature owns only its style element and marker attributes; it does not move or
wrap native nodes.

## Safety and rollback

No data crosses the injection boundary and no network or mutation contract is
added. Removing the injection wiring, style node, and marker attributes fully
removes the behavior on reload.

## Acceptance criteria

- [x] No attention heading receives injected sticky positioning.
- [x] Legacy style nodes and marker attributes are removed on injection.
- [x] Legacy observers and focus listeners are disconnected.
- [x] Native nodes are not moved, wrapped, or reordered.
- [x] Both native injector paths install the behavior.
- [x] `npm run check` and `npm test` pass without a structure-budget increase.

## Verification plan

- Unit/source: cleanup ownership and absence of sticky CSS or observers.
- Integration: dedicated and primary injectors install the source.
- Real UI: expand each attention section and confirm its heading stays in native
  flow while rows appear below it.
- Readback: confirm the saved native section order after category cleanup.

## Historical behavior

The retired implementation previously marked exactly four headings:
  `现在`, `等待`, `本周`, and `待整理`; the remote-device area was unmarked.
The 2026-09-22 revision supersedes that behavior after the asymmetric expansion
direction was reported in the live sidebar.
