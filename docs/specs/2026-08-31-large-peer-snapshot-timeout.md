# Large peer snapshot timeout

## Status

Implemented and verified on 2026-08-31.

## Problem

A node with 160 large Codex sessions can need more than six seconds to build its
first snapshot after a restart. The SSH transport previously gave the remote
HTTP request six seconds and the process twelve seconds, so a healthy MacBook
Pro was projected as an abnormal node with zero sessions.

## Behavior

- Allow a bounded 25 seconds for an aggregate peer snapshot and 32 seconds for
  its SSH process.
- Keep activity reads and mutations on shorter, independently bounded paths.
- Preserve direct-SSH-first routing, relay fallback, strict host verification,
  loopback-only remote HTTP, response-size limits, and error isolation.
- A timeout still reports the node as unavailable; it must never fabricate an
  empty successful snapshot.

## Verification

- Assert separate bounded curl limits for snapshot, activity, and mutation
  transports.
- Run the full test and structure suites.
- Verify the deployed MacBook Pro returns all 160 sessions through the local
  federated endpoint instead of the abnormal zero-session projection.

## Rollback

Restore the previous six-second curl and twelve-second SSH bounds. No data or
configuration migration is involved.
