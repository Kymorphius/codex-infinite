# Adaptive live session refresh

## Status

Implemented and verified on 2026-08-31.

## Problem

The session center refreshes the aggregate task snapshot every 15 seconds and an
open remote conversation every three seconds. Those intervals are adequate for
idle browsing but make an active Codex turn appear stale after new commentary,
tool activity, or completion has already been written by the owning device.

## Goals

- Refresh the aggregate task snapshot every two seconds while any task is active.
- Return to the existing 15-second interval when no task is active.
- Refresh an open remote conversation every two seconds.
- Avoid overlapping requests when a previous refresh is still in flight.
- Preserve manual refresh, scroll-follow behavior, and failure isolation.

## Non-goals

- Stream renderer tokens that have not yet been persisted by Codex.
- Add a permanent socket or relay protocol in this iteration.
- Change task, activity, peer, or ownership data contracts.

## Design

A small browser refresh-policy module owns the bounded active, idle, and open
conversation intervals. The application uses a recursive timeout rather than a
fixed interval so the next delay is selected from the latest normalized task
snapshot and a slow request cannot accumulate queued refreshes. The remote
conversation controller likewise schedules its next refresh only after the
previous refresh finishes. Existing loading guards remain a second line of
defence.

The live path remains polling and therefore works unchanged over direct SSH and
relay fallback. A future event transport can replace the scheduler while keeping
the same normalized UI contracts.

## Verification

- Unit-test active and idle delay selection.
- Unit-test that a scheduler selects its next delay after each completed refresh
  and stops cleanly.
- Run `npm run check` and `npm test`.
- Verify the deployed aggregate endpoint reports a newly completed task as
  completed and an executing remote task as active.

## Rollback

Restore the fixed 15-second task interval and three-second conversation interval.
No data migration or server rollback is required.
