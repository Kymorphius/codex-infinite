# Dispatch task details and rescheduling

- Status: accepted
- Owner: Codex Control Console
- Date: 2026-09-03
- Related ADRs: none

## Problem

After a dispatch task is created, the board exposes only queue, backlog, and
delete operations. A typo, incomplete prompt, wrong conversation, or changed
delivery time requires deleting and recreating the task. Scheduled cards show an
absolute timestamp but not how soon they will run. The generic PATCH path also
accepts system-owned status names even though the browser has no legitimate
reason to write them.

## Goals

- Open every card in an accessible details panel.
- Edit title, prompt, project, target conversation, and schedule for backlog and
  scheduled tasks.
- Let a scheduled task return to backlog without deleting it.
- Show a concise relative time hint beside scheduled timestamps.
- Validate changed conversation targets against the current local task index.
- Prevent browser callers from forging sending, sent, or failed status.

## Non-goals

- Editing queued, sending, sent, failed, or cancelled task content.
- Editing execution timestamps or error records.
- Drag-and-drop movement.
- Remote-device dispatch targets.

## User experience

Each task card has a `查看详情` action. It opens a right-side modal panel with the
full prompt, route, timestamps, and error. Backlog and scheduled tasks receive
editable fields. Saving with a future time places the task in `已排期`; saving
without a time places it in `待排期`. A scheduled card also exposes `取消排期`,
which clears its time and returns it to backlog. Other lifecycle states are
read-only and explain why editing is unavailable. Escape, the close button, and
the backdrop close the panel; focus returns to the originating card action.

## Contracts and data

`PATCH /api/dispatches/:id` continues to return the same response envelope. It
now accepts bounded optional content fields (`title`, `prompt`, `project`,
`targetThreadId`) in addition to `status` and `scheduledAt`. The HTTP adapter
resolves project/thread identity and supplies trusted `targetThreadTitle` and
`cwd`; callers cannot provide those trusted fields. Browser-written status is
limited to `backlog`, `scheduled`, `queued`, and `cancelled`. Scheduling requires
a future timestamp. Moving to backlog or queue clears `scheduledAt`.

Persisted dispatch objects retain version 1 and add no fields. Existing objects
need no migration.

## Design and ownership

`src/dispatch-board.mjs` owns editable-state and manual-transition policy plus
bounded normalization. `src/dispatch-http.mjs` owns current-target resolution.
`public/features/dispatch/index.js` owns detail disclosure, editable form state,
relative schedule presentation, and requests. Panel markup and task styles stay
in their existing UI files. Domain policy remains independent from HTTP and DOM.

## Security and privacy

PATCH remains protected by exact dashboard origin, JSON content type, and bounded
body parsing. Project and conversation changes must resolve through the local
read-only task index. Untrusted caller values cannot set target title, cwd,
execution timestamps, errors, or system-owned statuses. No listener or credential
behavior changes.

## Rollout and rollback

The existing persisted format and response contract are compatible. Rolling back
removes the added editor and restores the smaller PATCH allowlist without data
migration.

## Acceptance criteria

- [x] Every rendered task can open and close an accessible details panel.
- [x] Backlog and scheduled tasks can update bounded content and a valid target.
- [x] Adding a future time schedules a backlog task.
- [x] Clearing or cancelling a schedule returns the task to backlog and clears time.
- [x] Queued, sending, and terminal task content is read-only.
- [x] Browser PATCH cannot forge system-owned lifecycle statuses or trusted target metadata.
- [x] Scheduled cards show absolute and relative timing.
- [x] Existing create, queue, retry, delete, and scheduler behavior remains green.

## Verification plan

- Unit: update allowlists, editable-state rules, scheduling semantics, and relative labels.
- Integration: PATCH target resolution, origin/content-type protections, invalid target rejection.
- Real UI: details open/close/focus, edit fields, project/thread dependency, reschedule/cancel.
- Structure and regression: `npm run check` and `npm test`.

## Shipped deviations

None.
