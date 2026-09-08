# Native remote-device sidebar sections

- Status: shipped
- Owner: Codex Control Console
- Date: 2026-08-31
- Related ADRs: none

## Problem

The native Codex sidebar mixes attention views and local projects but has no
stable place for projects and conversations owned by each remote device. A
location tag on an individual indexed conversation removes ambiguity, yet it
does not provide a device-first way to browse remote work.

## Goals

- Add one compact, independently collapsible sidebar row for every configured
  remote Codex device.
- Show the device's connection state and total project/conversation counts.
- Within an expanded device, group conversations by their current project name
  and expose projects in weighted-priority order with each project's bounded,
  newest-first conversation list.
- Let a connected remote conversation row open the existing remote-conversation
  workspace with mouse or keyboard activation.
- Place the remote-device area after the local project and temporary-work
  sections, immediately above `云工作`.
- Keep remote refresh failures from delaying or damaging the native sidebar.

## Non-goals

- Replacing, moving, or changing native attention, project, or conversation
  nodes.
- Opening an offline cached conversation or bypassing owner-device validation.
- Persisting device or project expansion state across renderer restarts.
- Showing paths, prompts, message bodies, credentials, or peer connection
  details.

## User experience

The sidebar gains a `远端设备` heading followed by one device tag per remote
node. Device rows are collapsed by default to preserve the attention layer.
Each tag contains the configured device name plus either project/conversation
counts or `离线`. Expanding a device reveals its first twelve projects;
“显示另外 N 个项目” expands the remaining projected projects and
“收起到前 12 个项目” restores the compact view. Expanding a project reveals
recent conversations in newest-first order. Projects beyond the transport
bound and additional conversations are summarized with an explicit remaining
count.

The device and project expansion choices survive snapshot refreshes for the
life of the renderer. If a device becomes unavailable, its row remains visible
with an offline state and its last safe cached projection until a later refresh
replaces it.

Remote section headings sample the native projects heading typography; device
and project rows sample a native project row; conversation rows sample a native
conversation row. Text colors use the same live native theme tokens, so font,
size, weight, line height, and color remain aligned across themes and renderer
refreshes. Compact count/status pills retain the existing sidebar-label scale.

Connected conversation rows are native-style buttons. Activation sends only
the bounded conversation ID and remote device ID to the existing dashboard
frame. The sessions feature resolves that reference against its latest
normalized task snapshot and opens the already-shipped remote conversation
workspace only when both IDs match a non-local task. Offline cached rows remain
visibly disabled.

The remote-device subtree is an independently ordered sidebar item. Its order
is immediately before `云工作`, leaving the bottom sequence as `远端设备`,
`云工作`, `聊天 项目`, and `聊天` without moving native section nodes.

## Contracts and data

The injection boundary receives at most eight devices, sixty-four projects per
device, and six conversations per project. Only the first twelve projects are
rendered until the user explicitly expands that device. The normalized shape
contains only:

- device id, display name, status, project count, and conversation count;
- project key, current display name, conversation count, and hidden count;
- conversation id, bounded title, status, and update timestamp.

Remote devices come from the normalized federated device list and retain their
configured order so activity does not make device rows move. Tasks are joined
by device id, grouped by `cwd` or stable project key, and labeled with
`projectDisplayName || project`. Projects use the shared bounded project
priority calculation and deterministic recency/name tie-breakers; conversations
inside each project remain newest-first. Duplicate thread ids are removed before
bounds are applied.

## Design and ownership

- `src/native-remote-sidebar.mjs` owns projection, stale-while-revalidate
  caching, snapshot normalization, and the isolated DOM injection source.
- `src/injector.mjs` and `src/native-owner-injector.mjs` install and synchronize
  the source in the dedicated wrapper and primary Codex window.
- `src/main.mjs` wires the existing read-only federated task adapter into the
  provider.
- The injected root is the only DOM subtree owned by this feature. It is
  inserted before the native projects section and is removed/recreated on a
  version change; native React-owned nodes are never reparented.

## Safety and privacy

The feature is read-only and adds no network listener or mutation route. Remote
SSH access remains behind the existing adapter. All strings and arrays are
bounded before crossing into the renderer, and no filesystem or credential
metadata is included.

## Acceptance criteria

- [x] Every configured remote device has a distinct sidebar tag.
- [x] Online tags show project/conversation counts; unavailable tags show
  `离线`.
- [x] Expanded devices group current project names and expanded projects show
  newest-first conversations.
- [x] Projects inside each device follow shared weighted project priority while
  device rows retain configured order.
- [x] The area appears before the native projects section without moving native
  DOM nodes.
- [x] Expansion state survives data refreshes within the same renderer.
- [x] Slow or failed remote refreshes do not block injector synchronization.
- [x] Bounds and hidden-count summaries prevent an unbounded sidebar.
- [x] A device with more than twelve projected projects can reveal and collapse
  the remaining project rows without losing project expansion state.
- [x] Remote headings, devices, projects, and conversations match the
  corresponding native sidebar typography and theme colors.
- [x] Connected conversation rows are clickable and keyboard accessible.
- [x] Activation opens the exact conversation on its owning remote device.
- [x] Offline cached rows cannot open a conversation.
- [x] `npm run check` and `npm test` pass without a structure-budget increase.

## Verification plan

- Unit: remote-only projection, grouping, sorting, deduplication, connection
  state, text limits, item bounds, and stale-while-revalidate behavior.
- Integration: both injectors install the source and apply snapshots.
- Injection source: assert insertion before native projects, isolated owned root,
  renderer-lifetime expansion state, and no native node reparenting.
- Real UI: inspect device rows, nested project/conversation layout, counts,
  section order, expansion refresh, and offline presentation.
- Regression: run full syntax, structure, and test suites.

## Rollback

Remove the provider wiring and isolated source. A renderer reload then returns
the sidebar to its native-only structure; no persisted user or project state
requires migration.

## Shipped deviations

None.

## Shipped evidence

- The live dedicated sidebar rendered two separate remote-device rows before
  the native `项目` section. `MacBook Pro` reported `12 项目 · 160 会话`, while
  the currently unavailable `Windows Desktop` row reported `离线`.
- Expanding `MacBook Pro` exposed twelve bounded project rows. Expanding its
  newest project displayed six recent conversation titles plus an explicit
  `另有 6 个会话` summary.
- Live DOM inspection confirmed the owned remote root's next sibling was the
  native projects section. No native sidebar node was moved into the owned
  subtree.
- Visual inspection at the active desktop viewport confirmed device names and
  count/status pills remain on one row without clipping or overlap.
- Live computed-style comparison confirmed the remote `远端设备` heading and
  native `项目` heading both use 14px/21px, weight 500, and the identical
  tertiary color. Remote device/project names and native project names all use
  14px/21px, weight 400, and the same 85% theme text color. Remote and native
  conversation titles both use 14px/20px with the same family, weight, color,
  and opacity.
- The typography sampler reads the current native project and conversation
  nodes at render time, while colors remain bound to native theme variables;
  the previous fixed 16px project and 12px/72%-opacity conversation styles were
  removed.
- The primary-owner injection path is covered by the same source/snapshot
  integration tests; its CDP endpoint was not enabled during live verification.
- Connected rows now render as native buttons and pass only conversation/device
  identifiers through the dashboard bridge. Unit coverage confirms exact-owner
  resolution and rejects local, mismatched, and offline references. Live
  inspection after restart confirmed injection versions `2026-09-01.4` and
  `2026-09-01.3`, the remote root, and the callable open bridge without opening
  a user conversation during verification.
- Current live inspection showed one owned remote root, both configured devices
  online, and Windows projects projected in shared weighted-priority order while
  each project's conversations remained newest-first.
- Syntax and structure checks passed for 182 and 200 files respectively with
  zero frozen debt. All 269 tests passed.
