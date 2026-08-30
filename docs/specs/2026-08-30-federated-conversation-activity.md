# Federated conversation activity

- Status: shipped
- Owner: Codex Control Console
- Date: 2026-08-30
- Related ADRs: `docs/adr/0001-federated-nodes-through-relay.md`, `docs/adr/0002-owner-routed-conversation-access.md`

## Problem

Federated nodes can see remote conversation summaries, but cannot see the native interaction that is progressing on the owning device. Opening a remote task in the local native application would be false ownership, while copying native session files would create a second chat store.

## Goals

- Show a bounded, read-only view of recent native conversation activity from the owning node.
- Preserve device ownership and use the existing direct-SSH-first, relay-fallback provider boundary.
- Refresh an open remote activity view without refreshing the full page.
- Exclude filesystem paths, reasoning content, tool inputs/outputs, credentials, and unknown native fields.

## Non-goals

- No session-file replication, transcript database, token streaming, remote prompt submission, or remote native navigation in this increment.
- No raw tool arguments, tool results, chain-of-thought, or arbitrary event payloads.
- No LAN or public HTTP listener.

## User experience

A remote session row offers “打开远端对话”. It replaces the dashboard content area with a full native-workspace conversation view while retaining the surrounding local Codex window. The workspace is labelled with the owning device and read-only state. It shows recent user messages, assistant commentary/final messages, tool names and lifecycle status, and task start/completion markers. It refreshes every three seconds while open. Network or parse failure remains contained to that workspace.

Local rows continue to open the native conversation. The activity contract remains a read-only mirror and never becomes a local copy. Interactive continuation is provided by the separately authenticated owner-action contract in `2026-08-30-federated-remote-messaging.md`.

## Contracts

The owner exposes `GET|HEAD /api/node/activity/:threadId` on its loopback dashboard. The response uses schema version 1 and contains at most 60 normalized entries. Each message is at most 4,000 characters and the adapter reads at most the bounded tail of the native JSONL file.

The local dashboard exposes `GET|HEAD /api/tasks/:threadId/activity?device=:nodeId`. It routes local ownership to the local adapter and remote ownership to the configured peer adapter. The device id is mandatory, so equal native thread identifiers on different nodes are not ambiguous.

SSH remains the authenticated transport: the peer invokes a fixed loopback URL through a validated argument array, with strict host-key checking, non-interactive authentication, time and output bounds, direct transport first, and relay fallback second.

## Security and privacy

- Only allowlisted native record types become normalized activity entries.
- Assistant reasoning, encrypted content, tool input, tool output, event details, session paths, and unknown fields are dropped.
- Browser state receives no SSH credentials or filesystem locations.
- Responses use `no-store`; the console does not persist mirrored activity.
- The route is read-only. Future cross-node mutations require a separate signed owner-action contract and exact owner routing.

## Acceptance criteria

- [x] Remote activity is fetched from the owner through direct SSH with relay fallback.
- [x] Local and remote thread ids are resolved with explicit owning-device identity.
- [x] Activity parsing is bounded and drops tool payloads, reasoning, paths, and unknown fields.
- [x] The remote viewer refreshes while open and shows isolated loading, empty, and error states.
- [x] Existing native-open behavior and standalone behavior remain unchanged.
- [x] `npm run check` and `npm test` pass.

## Shipped evidence

- MatrixBook Air fetched a 60-entry MacBook Pro conversation through `direct-ssh`; the normalized response contained 17 messages, 32 tool lifecycle entries, and 11 status markers with no forbidden raw fields.
- The relay loopback route on `67.230.169.158:47842` independently returned the same schema-v1 owner activity when accessed through authenticated SSH on port 33699.
- Real UI inspection opened a MacBook Pro session in the local “会话中心”, rendered the owner label and recent native activity, and preserved three-second refresh behavior without browser persistence.
- The follow-up workspace treatment expanded the remote activity from a side drawer to the full embedded Codex work area, keeping the local native window chrome while making ownership explicit.
- Both Macs passed 97 tests and the 103-file structure check with zero frozen debt after deployment.

## Verification plan

- Unit: parser allowlist/redaction/bounds; remote response normalization; owner routing and collisions.
- Integration: local owner endpoint, aggregate proxy endpoint, HEAD/method/error behavior, and SSH argument safety.
- Real nodes: open a remote conversation from each Mac, compare recent visible activity with the owner, and verify direct and relay retrieval.
