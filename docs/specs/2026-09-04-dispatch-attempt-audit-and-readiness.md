# Dispatch attempt audit and runtime readiness

- Status: accepted
- Owner: Codex Control Console
- Date: 2026-09-04
- Related ADRs: 0003, 0004, 0006, 0010

## Problem

The dispatch board stores only the latest task snapshot. A process restart turns
an in-flight `sending` task back into `queued`, even though the previous Codex
process may have accepted or completed the prompt. Automatic retry can therefore
duplicate work. Operators also cannot distinguish dashboard availability from
native-desktop and scheduler readiness.

## Goals

- Preserve uncertain in-flight delivery after restart without automatically
  resubmitting it.
- Give every claimed execution a stable attempt identity and retain a bounded,
  redacted audit trail of lifecycle changes.
- Make retries explicit and keep prior attempt outcomes unchanged.
- Expose passive, read-only readiness checks for the dashboard, native desktop,
  dispatch store, audit store, and scheduler.

## Non-goals

- Event sourcing, replaying the audit log, or rebuilding task state from events.
- Automatic retry, workflow orchestration, tmux/HUD integration, or a second
  conversation runtime.
- Sending a diagnostic prompt or otherwise mutating a Codex conversation.
- Remote aggregation of diagnostics in this iteration.

## User experience

An interrupted in-flight task appears in “异常与取消” as “交付结果未知.” It
explains that the control process restarted while delivery was in progress and
offers an explicit “重新尝试” action. Retrying only queues a new attempt; it does
not rewrite the previous attempt.

Task details show the attempt count and current attempt identifier when present.
The existing loading, empty, and error behavior remains unchanged.

`GET /api/diagnostics` returns passive readiness checks and reasons. It performs
no execution smoke test and does not send messages.

## Contracts and data

Dispatch snapshot version advances from 1 to 2. Each item may contain:

- `attemptCount`: non-negative integer, defaulting to zero for legacy records.
- `activeAttemptId`: identifier of the latest claimed attempt, or null.
- `deliveryUncertainAt`: timestamp set when an in-flight task is recovered after
  restart, otherwise null.

`delivery_unknown` is a system-owned status. Browser clients may transition it
only to `queued` or `cancelled` through the existing bounded PATCH contract.
Claiming a queued task increments `attemptCount`, creates a new
`activeAttemptId`, and clears `deliveryUncertainAt`.

The audit adapter appends JSONL records containing only bounded operational
metadata: event id, dispatch id, attempt id, event type, resulting status,
timestamp, and optional reason. Prompts, titles, working directories,
credentials, and execution transcript content are never recorded.

The task snapshot remains the sole current-state authority. The audit journal is
diagnostic history and is never replayed.

## Design and ownership

- `src/dispatch-board.mjs` owns task and attempt transition policy.
- `src/dispatch-audit.mjs` owns append-only, best-effort audit persistence and
  bounded audit reads.
- `src/dispatcher.mjs` owns scheduler observations.
- `src/runtime-diagnostics.mjs` derives normalized passive readiness.
- `src/diagnostics-http.mjs` exposes the read-only transport.
- Dispatch UI modules render the new status and attempt metadata.
- `src/main.mjs` only wires the new collaborators.

Audit write failure does not roll back or invalidate the authoritative task
snapshot. It is retained as a degraded diagnostic condition.

## Security and privacy

Both snapshot and audit files use current-user-only mode and atomic directory
preparation. The audit allowlist excludes user prompts, paths, titles, raw
errors, transcripts, and credentials. Diagnostic output contains normalized
statuses and bounded reasons only.

All endpoints remain loopback-only. Diagnostics are GET/HEAD only. Existing
exact-origin enforcement continues to protect dispatch mutations, and clients
cannot provide attempt ids, counts, timestamps, or audit evidence.

## Rollout and rollback

Legacy version-1 items are normalized in memory and saved as version 2. A task
found in `sending` becomes `delivery_unknown`; it is not automatically queued.
Rollback can ignore the additive attempt fields, but version-2
`delivery_unknown` items must be manually moved to backlog or queue before using
an older build that does not recognize the status.

## Acceptance criteria

- [x] Restart converts `sending` to `delivery_unknown` without dispatching it.
- [x] Every claim creates a new attempt id and increments the attempt count.
- [x] Explicit retry creates a later attempt without rewriting the old audit
  record.
- [x] Stale completion for a non-current attempt is rejected.
- [x] Audit records are bounded and exclude task content and filesystem paths.
- [x] Browser clients cannot forge attempt metadata or `delivery_unknown`.
- [x] Diagnostics distinguish dashboard, native desktop, store, audit, and
  scheduler readiness without side effects.
- [x] Existing dispatch creation, editing, scheduling, and safety checks remain
  compatible.

## Verification plan

- Unit: migration, uncertain recovery, attempt creation, stale completion, audit
  redaction, and diagnostic derivation.
- Integration: retry allowlist, audit reads, diagnostics method handling, and
  existing mutation protections.
- Real UI: uncertain status, retry label, and attempt metadata in task details.
- Structure and regression: `npm run check` and `npm test`.

## Shipped deviations

None.
