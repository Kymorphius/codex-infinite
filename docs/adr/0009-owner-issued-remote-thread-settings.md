# ADR 0009: Owner-issued remote thread settings

## Status

Accepted on 2026-08-31.

## Context

A supervising node needs to edit another Mac's Codex thread settings. Applying
those settings in the browser, in a shared config file, or by rewriting rollout
records would create split-brain state and bypass the desktop's native policy
and managed requirements.

## Decision

The controller sends only normalized, allowlisted changes through an
exact-origin route and the existing signed owner-action transport. The owning
node validates the thread and advertised capabilities, then asks its already
running desktop App Server to update subsequent-turn model, reasoning, and
service-tier, and permission defaults. The existing resume path carries the
per-thread context override. The owner returns a bounded normalized
confirmation. Service-tier changes remain thread-scoped and never write the
global configuration.

For a dormant thread absent from the App Server's loaded set, the owner may
resume that exact thread and retry the setting update once. This background
load does not navigate the desktop or create a turn.

If another native process or profile already owns the thread writer, the owner
must preserve the single-writer boundary and surface the native rejection. A
future multi-runtime design may route the action to that actual owning App
Server, but must not take ownership by rewriting persisted session data.

Regardless of which process owns the writer, the newest complete
`thread_settings_applied` rollout event is the read authority. A private
persistent index performs one bounded-memory streaming pass, records the source
inode and complete byte offset, and then scans only appended bytes. Oversized
execution records are discarded line-by-line. An older head sample must never
override a newer setting that has moved outside the ordinary tail window.

The current turn is immutable. Settings become defaults for the next turn.
Context persistence commits only after native acknowledgement. Remote callers
cannot supply raw sandbox policies, approval policies, permission profiles,
context sizes, instruction text, or App Server configuration maps.

## Consequences

- Native policy enforcement and managed requirements remain authoritative.
- The native desktop and unified remote conversation use one thread runtime.
- A temporarily unavailable owner fails closed without a local-only state
  change.
- A thread held by another native writer remains readable but cannot be changed
  through this owner's App Server until the action can be routed to the actual
  writer.
- Supporting custom profiles or more settings requires a new explicit contract,
  tests, and UI rather than widening this action payload.
