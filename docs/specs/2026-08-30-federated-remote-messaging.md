# Federated remote messaging

- Status: shipped
- Owner: Codex Control Console
- Date: 2026-08-30
- Related ADRs: `docs/adr/0002-owner-routed-conversation-access.md`, `docs/adr/0003-signed-owner-actions.md`, `docs/adr/0004-native-codex-owns-live-conversations.md`

## Problem

The remote conversation workspace can mirror another node's native Codex session but cannot continue it. The product goal is symmetric control: a user on MacBook Pro must be able to send a message to a MatrixBook Air conversation, have MatrixBook Air resume and persist the real native thread against its real project, and see the resulting activity return to MacBook Pro.

## Goals

- Add a composer to remote conversation workspaces.
- Mirror an unsent owner-native draft into the remote composer and preserve it with revision-checked updates.
- Route every message by explicit owner node id and native thread id.
- Keep the owning node's Codex desktop application as the only live writer and submit through its native conversation composer.
- Authenticate owner mutations with short-lived HMAC signatures and nonce replay protection in addition to SSH transport authentication.
- Keep the prompt out of URLs, SSH/process arguments, logs, browser persistence, and secondary chat databases.
- Preserve direct-SSH-first and relay-fallback behavior without duplicate execution.

## Non-goals

- No token-level streaming, remote cancellation, queued offline delivery, multi-writer session files, or browser-side credentials in this increment.
- No local import of the remote session and no attempt to navigate the local native Codex router to a remote thread.

## User experience

The full remote conversation workspace includes a multiline composer. Enter sends and Shift+Enter inserts a newline. If the selected owner-native conversation contains an unsent draft, activity refresh copies it into the remote composer. The user may continue editing it or send it unchanged. The owner node opens the actual thread in its Codex desktop application and submits through the native composer. The existing three-second activity refresh shows the new user message, Codex progress, tools, and final answer.

Draft updates use compare-and-swap semantics. The remote composer sends the revision it originally read. The owner replaces its draft only when that revision still matches; otherwise it returns a conflict and the remote side refreshes instead of silently overwriting concurrent owner input.

The workspace always shows its owner. Sending does not optimistically invent an assistant response.

## Protocol

The browser sends `POST /api/tasks/:threadId/messages?device=:ownerNodeId` to its own loopback dashboard with the exact dashboard Origin and a bounded JSON body `{ "prompt": "..." }`.

The local peer adapter creates one request id/nonce, timestamp, and exact JSON body. It signs the canonical form `METHOD\nPATH\nTIMESTAMP\nNONCE\nSHA256(body)` using HMAC-SHA256. It invokes a fixed owner-loopback `POST /api/node/actions/message` through SSH and writes the JSON body to curl stdin using `--data-binary @-`. Direct and relay retries reuse the same nonce and body.

The owner loads its mode-0600 action key, verifies signature length and value using constant-time comparison, permits a maximum 30-second clock skew, and records the nonce in an in-memory replay window. A replay is acknowledged as a duplicate without executing again. The owner validates the local thread, refuses a thread already being remotely resumed, opens the native conversation route through the loopback CDP adapter, and submits through the native composer. It never falls back silently to a second CLI writer.

Keys live outside the peer definition:

- Owner verification key: `~/.codex-control-console/node-action.key`
- Requester copy for a peer: `~/.codex-control-console/peer-keys/:peerId.key`

Each file is base64-encoded random 32-byte key material and must have mode 0600. Keys never enter API responses or browser state.

## Failure and idempotency

- Transport failure tries the next configured transport with the same nonce.
- If the first transport executed but lost its response, the retry is a replay and returns accepted-with-duplicate without a second resume.
- Authentication, invalid input, missing thread, or owner-busy responses do not fall through to another transport.
- Acceptance is returned only after the owner native composer has cleared, confirming that Codex accepted the message. Completion truth continues to come from the native activity stream.

## Acceptance criteria

- [x] MacBook Pro can submit a message into a MatrixBook Air native conversation and observe it in the owner session file/activity stream.
- [x] MatrixBook Air can do the symmetric operation against MacBook Pro.
- [x] Missing/wrong keys, stale timestamps, modified bodies, and repeated nonces fail closed; repeats never execute twice.
- [x] Prompts are absent from command arguments, URLs, logs, and peer configuration.
- [x] Exact-origin protection remains mandatory on the browser-facing mutation.
- [x] Owner execution uses the local task cwd and native thread id.
- [x] The owner Codex desktop application remains the only live writer and submits the prompt through its native conversation UI.
- [x] Opening the owner conversation never reports that it is open in another application because of a remote message.
- [x] A visible unsent owner-native draft is mirrored to the remote composer, can be continued remotely, and is replaced only when its revision still matches.
- [x] Both nodes pass full tests and structure checks after deployment.

## Shipped evidence

- MatrixBook Air submitted marker `NATIVE_OWNER_TEST_20260830` to MacBook Pro over direct SSH. MacBook Pro selected native route `local:01a04445-8d03-7243-a4d3-181180bb626d`, displayed the prompt and assistant reply “原生界面续接成功。” in the owner Codex window, and completed the turn without an ownership-conflict or retry banner.
- MacBook Pro then held an unsent native draft. MatrixBook Air read its text and revision through the activity contract, extended it with marker `DRAFT_SYNC_TEST_20260830`, and submitted it with the matching revision. MacBook Pro replaced the unchanged draft, sent it through the native composer, displayed “草稿同步续接成功。”, and cleared the composer without an ownership conflict.
- Process inspection during the native-owner test found no `codex exec resume` process. The desktop application was the only live conversation writer.
- A relay-only signed request reached MacBook Pro through `67.230.169.158:33699` and its loopback-forwarded owner endpoint. The valid signature passed and the owner truthfully rejected the deliberately missing thread without executing anything.
- Both owner keys and peer copies are 32-byte base64 material stored in mode-0600 files. Neither peer JSON contains action credentials.
- Real UI inspection confirmed the remote composer, owner label, destination-specific placeholder, and enabled send action in the full embedded Codex workspace.
- Final validation covered 106 tests and 112 structure-checked files with zero frozen debt.
