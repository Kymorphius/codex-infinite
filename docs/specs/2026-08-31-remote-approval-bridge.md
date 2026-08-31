# Remote approval bridge

## Status

Implemented and deployed to the MatrixBook Air and MacBook Pro nodes on
2026-08-31.

## Problem

The unified conversation can observe and interrupt a remote native turn, but an
approval requested by command execution, file change, or additional permissions
is actionable only in the owner desktop UI. A user following the conversation
from another trusted node must return to that device before the turn can
continue.

Rollout files do not contain the live JSON-RPC request identifier needed for a
valid response. Reconstructing approval prompts from history or clicking UI by
text would be incomplete and unsafe.

## Goals

- Capture supported approval requests from the complete Codex desktop that owns
  the turn without replacing its native request handler.
- Project a bounded, redacted approval card into the unified conversation.
- Allow only one-turn acceptance or denial in the first version.
- Route the decision back to the exact pending owner request over the existing
  signed, replay-protected node action boundary.
- Let native approval on the owner device and remote approval race safely: the
  first valid response wins and every surface removes the resolved request.
- Preserve native Codex as the sole execution and policy authority.

## Non-goals

- Session-wide approval, exec-policy amendments, or persistent network-policy
  changes.
- Arbitrary App Server responses or client-selected permission payloads.
- MCP elicitation, user-input questions, plan implementation, or option pickers.
- Approval reconstruction from rollout files.
- Replacing the owner desktop's native approval interface.

## Protocol contract

The owner renderer observes only these App Server server-request methods:

- `item/commandExecution/requestApproval`
- `item/fileChange/requestApproval`
- `item/permissions/requestApproval`

Each accepted request must contain UUID thread and turn identifiers, a bounded
item identifier, and a valid JSON-RPC request id retained only inside the owner
renderer. The renderer creates a random opaque approval token and exposes only a
bounded projection: token, kind, thread/turn, item, start time, reason, command,
working directory, network host, requested permission summaries, and the
available one-turn decisions. Raw request ids, policy amendments, environment
data, command output, and hidden context never leave the owner renderer.

The activity endpoint includes at most eight pending approvals for its exact
thread. Peer normalization validates every field and the aggregate payload size.
The browser posts `{ action: "resolveApproval", turnId, approvalToken,
decision }`, where decision is only `accept` or `decline`.

The owner renderer looks up the opaque token, verifies the exact thread and turn,
and derives the App Server response from the stored request:

- command/file accept -> `{ decision: "accept" }`
- command/file decline -> `{ decision: "decline" }`
- permissions accept -> requested permissions with `scope: "turn"`
- permissions decline -> empty permissions with `scope: "turn"`

The browser cannot provide a command, permission object, request id, response
method, session scope, or persistent amendment.

## Resolution lifecycle

The injected owner bridge keeps request ids in memory only. It removes a pending
request after sending a response, after `serverRequest/resolved`, after the
matching item/turn completes, on expiry, or when the renderer is destroyed. If
the native UI resolves first, the App Server resolution notification removes the
remote card on the next activity refresh. If the remote UI resolves first, the
same notification lets the native desktop remove its native prompt.

An unknown, expired, resolving, already-resolved, cross-thread, or cross-turn
token fails closed with a conflict. The native interface remains available as
the recovery path.

## UI

Pending approvals appear immediately above the remote composer, using the
current native-derived theme. Cards state the device, action type, reason,
command or requested permissions, and the one-turn scope. `允许一次` is the
primary action and `拒绝` is secondary/destructive. While submitting, both are
disabled. An accepted decision shows a short status and disappears only after
the owner no longer reports it.

## Safety

- Dashboard mutations require exact origin and JSON content type.
- Peer mutations require the existing owner key, fresh timestamp, nonce, and
  body signature.
- Approval tokens are random UUIDs, memory-only, owner-issued capabilities.
- The owner bridge revalidates request ownership and derives all response data.
- No persistent approval option is exposed in the first version.
- Capture and response are limited to the local desktop App Server host.
- A missing native bridge or unsupported protocol fails closed.

## Verification

- Unit-test request capture, redaction, expiry, lifecycle cleanup, exact response
  derivation, races, and invalid tokens in an isolated renderer harness.
- Unit-test peer normalization and aggregate size bounds.
- Unit-test browser origin, signed owner routing, stdin transport, service
  ownership checks, and native adapter delegation.
- Unit-test approval-card rendering and submitting states.
- Run `npm run check`, `npm test`, and real two-node UI inspection without
  approving an unrelated live task.

## Rollback

Remove the approval injection, activity projection field, resolve action, and UI
cards. Native owner approvals continue to work unchanged.

## Implementation evidence

- The installed desktop renderer on both nodes reports the same approval bridge
  version and exposes only the bounded read/resolve helpers.
- The activity endpoint carries a validated `approvals` array while preserving
  older peers that omit it.
- Browser inspection confirmed native-derived dark colors, the approval asset,
  and a working return action after scrolling a completed remote conversation.
- `npm run check` and all 167 automated tests passed before deployment.
