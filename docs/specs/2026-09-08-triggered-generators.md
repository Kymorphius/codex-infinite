# Triggered generators

- Status: accepted for implementation
- Owner: Codex Control Console
- Date: 2026-09-08
- Related ADRs: none

## Problem

The dispatch board schedules one message at a time. It cannot preserve a reusable
set of tasks and start that set from one manual action or one future time. Users
therefore have to recreate related dispatches individually and cannot see which
messages came from the same occurrence.

## Goals

- Add a first-class generator containing an ordered snapshot of one or more tasks.
- Allow every generator to be started explicitly with a manual button.
- Allow an optional one-shot future trigger time. Manual starts do not consume it.
- Support two task actions: send a prompt to an existing local conversation, or
  create a persistent local conversation in the selected project and send its
  initial prompt.
- Materialize a trigger occurrence into the existing single-concurrency dispatch
  queue, preserving task order and existing delivery-uncertainty behavior.
- Persist bounded run history and expose the relationship between a run and its
  dispatches.
- Resume an interrupted materialization without creating duplicate dispatches.

## Non-goals

- Conversation-completed, all-prerequisites-completed, webhook, or remote-device
  triggers.
- Repeating calendar schedules.
- Dependency graphs, conditional branches, parallel execution, or automatic retry.
- Editing a saved generator in place. A generator can be removed and recreated;
  existing run records and dispatches remain audit evidence.
- Creating a conversation in a project that has no locally indexed conversation
  from which a verified project working directory can be resolved.

## User experience

A new `发生器` module lists saved generators and recent occurrences. `新建发生器`
opens a composer with a name, an optional trigger time, and an ordered task list.
Each task selects an action, local project, optional existing conversation, title,
and prompt. Tasks can be added or removed before saving.

Every saved generator has an `立即触发` button. A scheduled generator also shows
its pending time or that its one-shot schedule has fired. Triggering creates one
run and places its tasks into the normal dispatch queue in their configured order.
The occurrence card reports materializing, queued, running, completed, or failed
from the authoritative dispatch records. Generated dispatch cards identify their
generator and new-conversation destination.

The browser supplies a fresh request ID for a manual trigger and reuses it if the
same request is retried. The server treats that ID idempotently. Multiple separate
manual button presses intentionally create separate runs.

## Contracts and persistence

Generator state is stored as a mode-0600 JSON snapshot with version 1:

- definitions: stable ID, bounded name, optional ISO trigger time, schedule state,
  ordered normalized task snapshots, and creation/update/last-trigger timestamps;
- runs: stable ID, generator ID/name, source (`manual` or `scheduled`), optional
  request ID, immutable task snapshot, materialization state, ordered dispatch
  references, and trigger/materialization timestamps.

At most 100 definitions, 50 tasks per definition, and 200 recent run records are
retained. Removing a definition does not delete its runs. A scheduled trigger is
claimed and marked fired in the same atomic generator snapshot that creates its
run. Each generated dispatch carries generator, run, and generator-task IDs.
Dispatch creation is idempotent on the run/task pair. On startup and every poll,
unfinished materializations are reconciled before new dispatch work is claimed.

Existing dispatch snapshots remain backward compatible. Their action defaults to
`existing_thread`. A `new_thread` dispatch has no target thread before execution;
the CLI creates a persistent thread in its verified working directory and its
JSONL `thread.started` identifier is stored as `createdThreadId` when available.

HTTP routes are loopback-only and use exact-origin checks for every mutation:

- `GET /api/generators`
- `POST /api/generators`
- `POST /api/generators/:id/trigger`
- `DELETE /api/generators/:id`

The server resolves project, working directory, and existing-thread identity from
the read-only local task adapter. Browser-provided filesystem paths and target
titles are never trusted.

## Design and ownership

- `generator-contract.mjs` owns pure bounded validation.
- `generator-store.mjs` owns atomic definition/run persistence and due claims.
- `generator-service.mjs` owns reconciliation, dispatch materialization, and run
  status projection.
- `generator-http.mjs` owns normalized local target resolution and HTTP routes.
- `dispatch-board.mjs` owns backward-compatible dispatch action/source state and
  run/task idempotency.
- `dispatcher.mjs` remains the single execution lane and selects resume versus a
  new persistent `codex exec` invocation.
- `public/features/generators/` owns browser interaction and rendering.
- `src/main.mjs` only wires lifecycle dependencies.

## Security and failure behavior

Loopback binding, exact-origin mutation checks, bounded JSON bodies, credential
isolation, and read-only session indexing remain invariants. Only the configured
native Codex home executes tasks. The browser cannot provide a working directory.
New conversations are persistent and are never silently made ephemeral.

The run is persisted before any dispatch is created. A crash can leave it in
`materializing`; reconciliation resumes from its immutable snapshot. A crash after
submitting a dispatch retains the existing `delivery_unknown` policy and never
automatically retries that uncertain delivery. Failed tasks do not stop later
tasks because the existing global queue processes every materialized item.

## Acceptance criteria

- [x] A user can save a generator with multiple ordered tasks.
- [x] Every generator can be manually triggered; a retried request ID creates one run.
- [x] An optional future time fires exactly once and remains visible as fired.
- [x] Existing-conversation tasks resume the resolved conversation.
- [x] New-conversation tasks create a persistent thread and send the initial prompt.
- [x] Interrupted materialization resumes without duplicate dispatches.
- [x] Runs and generated dispatches show their relationship and truthful status.
- [x] Invalid origins, content types, paths, targets, times, and oversized inputs fail closed.
- [x] Existing dispatch snapshots and ordinary dispatch creation remain compatible.
- [x] `npm run check` and `npm test` pass.
- [x] The real embedded desktop module can create, render, and remove a generator without triggering messages.

## Rollout and rollback

The feature activates when the new store/service and static module are deployed.
Removing the module and service restores the old UI; existing dispatch data remains
readable because new fields are additive. The generator JSON can remain dormant.

## Shipped deviations

None.
