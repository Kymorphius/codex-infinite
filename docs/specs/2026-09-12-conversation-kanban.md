# ChatGPT / Codex 会话看板

- Status: accepted
- Owner: Codex Control Console
- Date: 2026-09-12
- Related ADRs: none

## Problem

ChatGPT and Codex conversations are visible in native sidebars, while work that
needs confirmation or acceptance is difficult to scan across conversations and
devices. Hermes cards require separate manual creation and therefore cannot be
the default index for native conversations.

## Goals

- Provide one board containing the normalized ChatGPT and Codex conversation
  catalog already exposed by every connected owner.
- Project conversations into `正在进行`, `待确认`, `待验收`, `已完成`, `异常`
  and `待核对` without creating duplicate workflow records.
- Open a card in its owning native conversation.
- Add conservative title/path based work-type labels for drawing, writing,
  development and research conversations.

## Non-goals

- Persist a second conversation status database or create Hermes cards.
- Read ChatGPT message bodies or image attachments that the native sidebar does
  not expose.
- Infer final acceptance from an assistant turn finishing.
- Move, archive, rename or delete native conversations.

## User experience

The native header contains a `会话看板` button beside `项目管理`. It opens a
full workspace board and can also be reached at `/conversations.html`. Search and
filters cover title/path, owner device, source and inferred work type. Columns
remain horizontally scrollable on narrow screens. Loading, stale owners, empty
filters and failed reads are visible. Each actionable card has an `打开会话`
button; cached or ownerless records explain why opening is unavailable.
The sidebar catalog renders as soon as its authoritative read completes; slower
task and approval enrichment must not block the first visible cards.
Cards render in bounded animation-frame batches so the visible part of each
column becomes interactive before the complete catalog has been painted.

## Contracts and data

- `GET /api/sidebar` is the catalog authority. Identity is
  `[device.id, conversation.key]`; equal titles and IDs across devices do not
  merge.
- `GET /api/tasks` only enriches matching Codex records with update time and
  current task status. Active Codex tasks read their activity endpoint to detect
  pending approval records. Local owner activity uses `/api/node/activity/:id`;
  remote activity uses `/api/tasks/:id/activity?device=:deviceId`.
- The controller reads and renders the validated sidebar before starting the
  heavier task query, preventing task collection from delaying the catalog on
  the loopback service.
- State priority is: explicit native conversation section, pending approval,
  error/interruption, active turn, completed turn, unknown. Completed turns map
  to `待验收`; `已完成` requires an explicit native conversation section named
  `已完成`, `完成` or `Done`.
- Only direct conversation membership can override workflow state. A project
  section is display context and cannot change all child conversation states.
- Opening first refreshes `GET /api/sidebar`, then `POST /api/sidebar/actions`
  opens the exact owner item using its native key, current section and latest
  revision. A conflict remains visible and is never replayed automatically.
- No schema migration or new persisted data.

## Design and ownership

The browser model owns validation, identity, state/type projection, filtering and
open-action payloads. The page controller owns reads, bounded activity enrichment
and user actions. The native entry only opens the loopback page. Existing sidebar
adapters and action handlers retain external-system ownership.

## Security and privacy

The page remains on the loopback dashboard and uses its existing exact-origin
native action boundary. It displays catalog metadata and bounded activity state;
it does not copy conversation bodies into another store. Opening is read/navigation
only and requires the owner's current revision and advertised capability.

## Rollout and rollback

The new page and native entry are additive. Removing the entry, route assets and
module allowlist restores the previous UI without data rollback.

## Acceptance criteria

- [ ] ChatGPT and Codex conversations from connected owner snapshots appear once
  per owner in the expected state column.
- [ ] Pending native approvals appear in `待确认`; completed turns appear in
  `待验收`; unknown ChatGPT state appears in `待核对`.
- [ ] Search and device/source/type filters update visible cards and counts.
- [ ] A slow task-status response does not delay the first sidebar-backed cards.
- [ ] Large catalogs paint their first visible cards before all remaining cards
  are appended, while final counts and filters still cover the full catalog.
- [ ] Every card and its open button remain inside the owning column at desktop
  and narrow widths, including titles or paths with long unbroken text.
- [ ] Opening a card sends the exact owner/key/section/revision contract and the
  native workspace closes after a confirmed local open.
- [ ] Offline or stale records cannot be opened.
- [ ] The native entry, frame recovery and static assets support `conversations`.
- [ ] `npm run check`, `npm test` and a rendered desktop/mobile inspection pass.

## Verification plan

- Unit: catalog identity, state priority, direct versus inherited section state,
  work-type inference, filtering and action guards.
- Integration: static allowlist, native header entry, module history and frame
  routing.
- Real UI: live owner counts, representative columns, filtering, responsive
  overflow, theme and card open behavior.
- Structure and regression: `npm run check` and `npm test`.

## Shipped deviations

None.

## Recorded verification

- `npm run check` passes with 399 syntax-checked and 429 structure-checked
  files. The full test suite passes 642/642, including reconstruction of an
  open action from a newly read sidebar revision.
- The live dark-theme page projected 246 owner-scoped conversations: 11 active,
  57 awaiting acceptance, one interrupted and 177 requiring review at inspection
  time. DevBook Air and MacBook Pro were connected; Windows was visibly
  offline. These counts are live state and will change.
- Searching `绘画` reduced the live catalog to two cards and clearing restored all
  246. The page was inspected at the normal desktop viewport and at 390 x 844;
  filters remain within the viewport and the six columns use intentional
  horizontal scrolling.
- Opening the current conversation returned the visible owner confirmation
  `已打开「评估 Hermes 看板集成」`. The restarted loopback service served the
  page and scripts with their expected content types.
- After reproducing a stale-revision conflict, opening the same conversation
  refreshed its owner catalog first and again returned
  `已打开「评估 Hermes 看板集成」`; the page returned to its normal updated
  state instead of remaining in `正在同步`.
- Before the first-paint change, the live sidebar endpoint completed in about
  2 ms while task collection took about 2.29 s and blocked the page. With 227
  live conversations, a reload displayed interactive cards in 124 ms, then
  completed all 227 cards and task status in the background. Filtering to
  `绘画` displayed one current match and clearing restored all 227 cards.
- The narrow live viewport reproduced a 375 px card overflowing a 270 px
  column. After constraining the list track and card, the same column contained
  a 244 px card and 216 px button; at 1440 px the 250 px column contained its
  224 px card and 196 px button. The rendered dark-theme page showed the cards
  and buttons contained within their respective columns.
