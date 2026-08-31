# Remote conversation control and incremental activity

## Status

Implemented and verified on 2026-08-31.

## Problem

The unified remote conversation can read activity and send a new message, but
every refresh reconstructs its whole transcript and it cannot stop an active
turn. Lifecycle rows also do not distinguish an interrupted turn from a normal
completion. This makes an active remote conversation feel less stable and less
controllable than the owner desktop.

## Goals

- Preserve and reuse unchanged transcript DOM nodes across activity refreshes.
- Expose the latest owner-recorded turn id and bounded state: active, completed,
  interrupted, or unknown.
- Allow the user to interrupt an active remote turn through the owning desktop's
  App Server connection.
- Authenticate remote interruption with the same signed, replay-protected peer
  action boundary used for remote messages.
- Show active/completed/interrupted state and a contextual stop control in the
  unified conversation header.
- Keep scroll position stable when the user is reading older activity.

## Non-goals

- Infer or fabricate approval prompts from rollout files.
- Approve a request owned by a different desktop App Server connection.
- Stop background subagents independently.
- Expose arbitrary App Server methods through HTTP or the renderer.

## Design

The rollout activity projection recognizes the current task/turn lifecycle
event variants. Because a long-running desktop turn can exceed the bounded
activity read window, it also recovers the latest turn id from allowlisted event
metadata and treats a newly observed turn as active until an explicit completion
or interruption record is seen. It returns the most recent turn id and state
alongside the existing allowlisted entries. Peer normalization validates both
values. No tool arguments, command output, reasoning, or hidden context is added
to the public contract.

The injected owner-desktop bridge exposes one UUID-validated operation backed by
the generated App Server `turn/interrupt` method. The native adapter calls only
that operation. The browser posts `{ action: "interrupt", turnId }` to the
selected task/device route; the local peer adapter signs an equivalent bounded
owner action and sends it over direct SSH first with relay fallback. The owner
verifies origin/signature, confirms the thread still exists, and then delegates
to the native adapter. Duplicate signed requests remain idempotently accepted.

The browser conversation model supplies stable render keys and signatures. The
controller walks the existing child list, reuses matching nodes, replaces only
changed entries, inserts new entries, and removes entries that fell outside the
bounded activity window. It still follows the latest entry only when the reader
was already near the bottom.

App Server approval requests are server-to-client requests delivered only to the
desktop connection that owns the running turn. The rollout projection does not
contain a safe actionable approval token. This slice therefore does not present
an approval button; forwarding pending requests and correlated responses is a
separate protocol change.

## Safety

- Both thread and turn identifiers must be UUIDs at the native boundary.
- Browser mutations require the exact dashboard origin and JSON content type.
- Peer mutations require the configured 32-byte owner key, fresh timestamp,
  nonce, and body signature.
- The action allowlist contains only `interrupt`; arbitrary method names and
  parameters are rejected before transport.
- An unavailable or non-owning native desktop fails closed without changing
  another task.

## Verification

- Unit-test lifecycle state projection, bounded-tail active-turn recovery, and
  peer normalization.
- Unit-test stable render identity/signatures and incremental UI behavior model.
- Unit-test browser origin checks, signed owner interruption, duplicate replay,
  SSH argument/body isolation, service validation, and native bridge delegation.
- Run `npm run check` and `npm test`.
- Deploy to both Mac nodes and verify the new static assets and aggregate status.

## Rollback

Remove the control routes and header button, restore full transcript replacement,
and omit top-level turn state from activity. Existing message, activity, and node
snapshot contracts remain compatible.
