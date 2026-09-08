# Dashboard refresh efficiency

- Status: shipped
- Owner: Codex
- Date: 2026-09-02
- Related ADRs: none

## Problem

The dashboard repeatedly reparses recent Codex JSONL session files and starts new SSH reads whenever independent UI refresh sources request the same task snapshot. On the observed host, 408 session files occupy about 7.5 GB and the dashboard process sustains more than one CPU core. An unavailable Windows peer also produces repeated SSH attempts and tens of thousands of duplicate warnings.

## Goals

- Reuse parsed session metadata while a file's size and modification time are unchanged.
- Coalesce overlapping local and federated task-list reads.
- Back off failed peer snapshot and activity reads, suppressing further transport attempts until the current cooldown expires.
- Preserve the current normalized task, device, activity, and HTTP contracts.

## Non-goals

- Changing dashboard refresh intervals or visible freshness semantics.
- Persisting the session cache across service restarts.
- Changing remote mutation retries, credentials, or transport trust.
- Deleting, rewriting, or migrating native Codex session files.

## User experience

The dashboard continues to refresh automatically. New or modified sessions appear on the next normal refresh. An offline peer remains visibly offline, but repeated reads during its cooldown return the normalized unavailable state without spawning more SSH processes. After the cooldown, a normal read probes recovery.

## Contracts and data

HTTP and normalized adapter outputs are unchanged. The session cache is process-local and keyed by absolute file path plus file size and modification time. Peer cooldown state is process-local and is not exposed as a new browser contract.

## Design and ownership

- `src/task-adapter.mjs` owns the filesystem metadata cache because it already owns native session file translation.
- `src/federated-task-adapter.mjs` owns coalescing aggregate reads.
- `src/ssh-peer-adapter.mjs` owns transport failure cooldown because it owns SSH execution and availability translation.
- Browser refresh policy remains unchanged and continues consuming normalized HTTP data.

Dependencies continue to point from application composition toward adapters and normalized contracts. No filesystem or SSH detail enters the UI.

## Security and privacy

Loopback-only HTTP, exact-origin mutation checks, credential isolation, read-only session indexing, and SSH argument validation are unchanged. Cached data remains in memory and contains only the session metadata already returned by the adapter. No credentials, session contents, or remote responses are newly persisted or logged.

## Rollout and rollback

The optimization activates when the service restarts. Restarting clears all caches and cooldowns, providing a safe recovery path. The change can be rolled back by reverting the three adapter-local optimizations without data migration.

## Acceptance criteria

- [x] Two task-list reads with unchanged files parse each selected session file only once.
- [x] A changed file is reparsed and its updated normalized task is returned.
- [x] Overlapping local and federated reads share one in-flight operation.
- [x] Repeated reads of an unavailable peer do not execute SSH again until the cooldown expires.
- [x] A successful recovery resets peer backoff.
- [x] Existing task, federation, security, and structure tests continue to pass.

## Verification plan

- Unit: session cache reuse/invalidation, in-flight read coalescing, peer cooldown/recovery.
- Integration: existing task and federation adapter suites.
- Real UI: restart the local dashboard and compare idle/active CPU after the cache warms.
- Structure and regression: `npm run check` and `npm test`.

## Shipped deviations

None. Full verification passed with 255 tests; after service restart and cache warm-up, six live CPU samples ranged from 0% to 5.3%, down from the observed 58% to 121.6% before the change. The dashboard continued returning HTTP 200.
