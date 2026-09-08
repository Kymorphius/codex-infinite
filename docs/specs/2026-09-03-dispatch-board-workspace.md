# Dispatch board workspace

- Status: accepted
- Owner: Codex Control Console
- Date: 2026-09-03
- Related ADRs: none

## Problem

The dispatch board puts its introductory copy, three large metrics, and the full
task form before the pipeline. At the normal desktop viewport the pipeline is
below the fold. Once reached, all six lifecycle columns are forced into a
1,225-pixel horizontal strip, so the user cannot scan the whole flow without
horizontal scrolling. The board also has no way to find tasks by text or
project when the local history grows.

## Goals

- Put the active task flow in the first viewport at a typical 1280 × 720 size.
- Show the four actionable stages together without horizontal page scrolling.
- Keep terminal results available without giving them equal first-screen weight.
- Add client-side task search and project filtering with a visible result count.
- Keep task creation available from the board without occupying space until it is requested.

## Non-goals

- Drag-and-drop status changes.
- Changing scheduling, persistence, dispatch concurrency, or delivery policy.
- Editing an existing task's title, prompt, target, or scheduled timestamp.
- Changing the dispatch HTTP contract.

## User experience

The board opens with a compact heading, inline metrics, and controls for creating,
searching, filtering, and refreshing. The creation form is collapsed by default;
the `新建任务` button expands it and moves focus to the title. The active pipeline
contains `待排期`, `已排期`, `排队中`, and `发送中` in one responsive grid.
`已发送` and `异常` appear in a separate result area below it.

Search matches title, prompt, project, target conversation, and error text.
Project filtering and search compose. Counts on columns and the result summary
reflect visible tasks; the top metrics continue to reflect all persisted tasks.
An explicit clear-filter action restores the unfiltered board. Empty, loading,
and error states retain their current behavior. Controls have visible labels,
the composer toggle exposes `aria-expanded`, and the filter summary is announced
politely.

## Contracts and data

None. Existing dispatch objects, persisted JSON, status values, HTTP routes, and
mutation bodies are unchanged. Filtering and composer disclosure are ephemeral
browser state.

## Design and ownership

`public/panels/board.html` owns the board markup and accessibility relationships.
`public/features/dispatch/index.js` owns client-side projection, filtering,
disclosure, and rendering. `public/styles/tasks.css` and
`public/styles/responsive.css` own presentation. The server-side dispatch store
and HTTP adapters remain unchanged.

## Security and privacy

No new data leaves the browser and no credentials are introduced. Search runs
only over the normalized dispatch data already returned to the loopback page.
All existing exact-origin mutation checks, loopback networking, bounded request
bodies, and target ownership behavior remain unchanged.

## Rollout and rollback

The layout and filtering activate with the static dashboard assets and require no
migration. Roll back the panel, feature, and stylesheet changes to restore the
previous presentation; persisted tasks remain compatible.

## Acceptance criteria

- [x] The active pipeline is visible without first expanding the creation form.
- [x] Four active columns fit the desktop content width without a forced 1,225px strip.
- [x] Terminal statuses remain visible in a separate result area.
- [x] Search and project filters compose and update visible counts.
- [x] Clearing filters restores every task.
- [x] Creating, queueing, moving to backlog, deleting, and refreshing still work.
- [x] The composer toggle is keyboard accessible and reports its expanded state.
- [x] Mobile layout uses a single column without horizontal board scrolling.

## Verification plan

- Unit: cover normalized search, project filter, and combined filtering.
- Integration: retain dispatch HTTP and persistence tests unchanged.
- Real UI: inspect the board at desktop and mobile widths, expand/collapse the
  composer, and exercise filters against rendered data.
- Structure and regression: run `npm run check` and `npm test`.

## Shipped deviations

None.
