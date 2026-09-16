# Dispatch queue order and held messages

- Status: accepted
- Owner: Codex Control Console
- Date: 2026-09-17
- Related ADRs: none

## Problem

Queued dispatches always run in creation order and the board offers no way to
change that order. The existing `backlog` state is non-executing, but the UI
describes it as temporary scheduling work instead of an intentional message
todo list, so users cannot confidently keep a message there indefinitely.

## Goals

- Let the user move a queued message earlier or later in the global send order.
- Persist the chosen order across refreshes and process restarts.
- Let a message be created or moved into an explicit `待办消息` area that never
  executes automatically, including when the active queue becomes empty.
- Require an explicit user action to move a held message into the send queue.
- Preserve scheduling, delivery uncertainty, and single-concurrency behavior.

## Non-goals

- Drag-and-drop interaction.
- Reordering scheduled, sending, completed, failed, or held messages.
- Pausing a message after it has already been claimed for sending.
- Adding remote targets or changing dispatcher concurrency.

## User experience

The first active column is named `待办消息` and explains that its messages are
kept only as todos and never sent automatically. Task creation offers `仅存为待办消息（不发送）`.
Queued cards show their current order and expose `上移` and `下移` actions.
The first and last queued cards disable the action that cannot change anything.
Scheduled or queued messages expose `仅保留待办`; held messages expose
`加入发送队列`.

Search and project filters do not change the meaning of ordering. Reorder
actions always apply to the complete persisted queue, including cards hidden by
the current filter. The next scheduler claim follows the persisted order.

## Contracts and data

Dispatch records add a nullable positive integer `queueOrder`. Every transition
into `queued` appends the message to the end of the current queue. Leaving the
queue clears `queueOrder`. On startup, legacy queued records without an order are
backfilled in their former creation-time order.

`PATCH /api/dispatches/:id/queue-order` accepts exactly one bounded action:
`{"direction":"up"}` or `{"direction":"down"}`. It succeeds only for a queued
message and atomically swaps that message with its adjacent queued neighbor.
The normal dispatch response envelope is retained.

The persisted document version advances to 3. Existing `backlog` records remain
compatible; `待办消息` is the clearer user-facing name for that same durable,
non-executing state.

## Design and ownership

`src/dispatch-board.mjs` owns queue-order normalization, transitions, movement,
and claiming. `src/dispatch-http.mjs` owns the exact-origin reorder endpoint and
its input allowlist. The dispatch browser feature owns labels and controls; it
does not calculate authoritative order changes.

## Security and privacy

The new mutation remains loopback-only and exact-origin protected, requires a
JSON body, and accepts only `up` or `down`. It cannot change target identity,
content, lifecycle timestamps, or system-owned delivery states.

## Rollout and rollback

Startup performs an idempotent queue-order backfill and writes the version 3
document atomically. Older builds ignore the additional field and fall back to
creation order, so rollback does not lose messages.

## Acceptance criteria

- [x] New held messages remain in `待办消息` through scheduler ticks and restarts.
- [x] Moving a scheduled or queued message to `待办消息` prevents future claims.
- [x] Moving a held, failed, cancelled, or uncertain message to the queue appends it.
- [x] Up/down changes persist and determine the next claimed message.
- [x] Filtered views never silently reorder only the visible subset.
- [x] Invalid, missing, terminal, and non-queued reorder requests fail closed.
- [x] Existing scheduling, retry, audit, and single-concurrency behavior remains green.

## Verification plan

- Unit: legacy backfill, held-message non-claiming, queue transitions, boundaries,
  persistence, and claim order.
- Integration: reorder origin/content-type/direction validation and missing/non-queued errors.
- UI: order labels, bounded up/down controls, held copy, and explicit hold/queue actions.
- Structure and regression: run `npm run check` and `npm test`.

## Shipped deviations

None.
