# Session device project priority order

Status: implemented and verified on 2026-08-31.

## Problem

Session Center keeps device cards in configured order so their positions do not
flap as activity changes. Inside each device, however, directory/project cards
must retain the product's weighted priority order. Sorting those cards only by
their latest conversation loses the recent-session and runtime components of
the established project-priority policy.

## Design

- Keep the device order stable and independent from activity.
- Within each device, calculate the existing bounded project-priority score for
  every directory group from that group's own sessions.
- Sort directory groups by descending priority score, then latest conversation,
  then current display name and directory for deterministic ties.
- Keep sessions inside each directory newest-first.
- Put the pure, browser-compatible priority calculation in shared core so the
  server priority view and Session Center use one policy rather than two copies.

## Acceptance criteria

- [x] A directory with a higher weighted score appears before a directory whose
  latest single conversation is newer but whose total score is lower.
- [x] Device order remains configured and stable.
- [x] Current renamed project display names do not affect score calculation.
- [x] Equal scores have deterministic fallbacks.
- [x] The server priority view continues to use the same score contract.
- [x] Focused and full regression checks pass.

## Verification

- Session UI regression tests cover weighted ordering and stable device order.
- Priority-domain tests continue to verify recency and runtime scoring.
- Static asset tests verify the shared browser policy is explicitly allowlisted.
