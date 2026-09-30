# Peer read fallback cooldown

## Problem and scope

When a preferred SSH route fails and a later route succeeds, each following peer
snapshot retries the failed route and repeats its warning. Peer-wide backoff only
applies when every route fails. Repeated native refreshes therefore keep spawning
failed SSH attempts even while a working fallback supplies current data.

This change owns snapshot and activity reads in `SshPeerAdapter`. It does not
change mutation routing, separate sidebar/skill adapters, SSH arguments, signed
actions, exact-origin checks, credentials, or persisted peer configuration.

## Contract

1. Keep route order. Track temporary read failure state by configured route index;
   two routes with the same display type remain independent.
2. After a failed read, skip that route until its retry deadline. Consecutive route
   failures use the existing exponential backoff base and maximum (5 to 60 seconds
   by default). Successful fallback reads do not clear another route's deadline.
3. After the deadline, try the preferred route again in configured order. A
   validated successful read clears that route's outage state and restores its
   normal priority. State lives only in the adapter instance.
4. Log a route outage once until that route recovers. A later outage after recovery
   logs again. Include the route number to distinguish equal transport labels,
   without exposing route addresses or command/error text.
5. Preserve existing peer-wide backoff and unavailable results when all eligible
   routes fail or all routes are cooling. Preserve overlapping snapshot coalescing.
6. Read cooldown is shared by snapshot/activity reads only. Mutation methods retain
   their existing configured-order attempts regardless of read cooldown.

## Validation

Use fixed-clock fake SSH fixtures: three sequential reads with a failed preferred
route and healthy fallback attempt the preferred route only once before its
deadline; retry at the deadline; verify exponential delay is capped; separate
equal-labelled routes; verify outage warning dedupe and recovery; verify fallback
failure still enters peer-wide backoff; exercise activity reads and snapshot
coalescing; prove a mutation still attempts a cooled preferred route.

Run the focused cooldown tests, existing federation/refresh tests, required
structure checks and the full suite. Activation and live CPU measurements belong
to the coordinating task; tests do not claim a measured CPU improvement.

## Implementation evidence

- Focused cooldown, federation and refresh tests: 23 passed. The fixed-clock
  three-read fixture now attempts the failed preferred route once and the healthy
  fallback three times, with one warning for that outage.
- Structure check passes; the adapter is 331 lines and focused test 143 lines.
- Combined required checks, full-suite verification and local commit are owned by
  the coordinating task. This subtask did not activate or restart any runtime.
