# Federated remote messaging

- Status: shipped
- Owner: Codex Control Console
- Date: 2026-08-30
- Related ADRs: `docs/adr/0002-owner-routed-conversation-access.md`, `docs/adr/0003-signed-owner-actions.md`

## Problem

The remote conversation workspace can mirror another node's native Codex session but cannot continue it. The product goal is symmetric control: a user on Forest Mac must be able to send a message to a MatrixBook Air conversation, have MatrixBook Air resume and persist the real native thread against its real project, and see the resulting activity return to Forest Mac.

## Goals

- Add a composer to remote conversation workspaces.
- Route every message by explicit owner node id and native thread id.
- Execute `codex exec resume` only on the owning node, with the prompt delivered over stdin.
- Authenticate owner mutations with short-lived HMAC signatures and nonce replay protection in addition to SSH transport authentication.
- Keep the prompt out of URLs, SSH/process arguments, logs, browser persistence, and secondary chat databases.
- Preserve direct-SSH-first and relay-fallback behavior without duplicate execution.

## Non-goals

- No token-level streaming, remote cancellation, queued offline delivery, multi-writer session files, or browser-side credentials in this increment.
- No local import of the remote session and no attempt to navigate the local native Codex router to a remote thread.

## User experience

The full remote conversation workspace includes a multiline composer. Enter sends and Shift+Enter inserts a newline. On acceptance, the owner node resumes the actual thread and the existing three-second activity refresh shows the new user message, Codex progress, tools, and final answer. A busy or unreachable owner produces an inline error and retains the draft.

The workspace always shows its owner. Sending does not optimistically invent an assistant response.

## Protocol

The browser sends `POST /api/tasks/:threadId/messages?device=:ownerNodeId` to its own loopback dashboard with the exact dashboard Origin and a bounded JSON body `{ "prompt": "..." }`.

The local peer adapter creates one request id/nonce, timestamp, and exact JSON body. It signs the canonical form `METHOD\nPATH\nTIMESTAMP\nNONCE\nSHA256(body)` using HMAC-SHA256. It invokes a fixed owner-loopback `POST /api/node/actions/message` through SSH and writes the JSON body to curl stdin using `--data-binary @-`. Direct and relay retries reuse the same nonce and body.

The owner loads its mode-0600 action key, verifies signature length and value using constant-time comparison, permits a maximum 30-second clock skew, and records the nonce in an in-memory replay window. A replay is acknowledged as a duplicate without executing again. The owner validates the local thread, refuses a thread already being remotely resumed, and starts the existing Codex CLI dispatcher asynchronously.

Keys live outside the peer definition:

- Owner verification key: `~/.codex-control-console/node-action.key`
- Requester copy for a peer: `~/.codex-control-console/peer-keys/:peerId.key`

Each file is base64-encoded random 32-byte key material and must have mode 0600. Keys never enter API responses or browser state.

## Failure and idempotency

- Transport failure tries the next configured transport with the same nonce.
- If the first transport executed but lost its response, the retry is a replay and returns accepted-with-duplicate without a second resume.
- Authentication, invalid input, missing thread, or owner-busy responses do not fall through to another transport.
- Accepted execution is asynchronous. Completion truth comes from the native activity stream; a process restart may lose an accepted-but-not-started in-memory request, which the user may resend.

## Acceptance criteria

- [x] Forest Mac can submit a message into a MatrixBook Air native conversation and observe it in the owner session file/activity stream.
- [x] MatrixBook Air can do the symmetric operation against Forest Mac.
- [x] Missing/wrong keys, stale timestamps, modified bodies, and repeated nonces fail closed; repeats never execute twice.
- [x] Prompts are absent from command arguments, URLs, logs, and peer configuration.
- [x] Exact-origin protection remains mandatory on the browser-facing mutation.
- [x] Owner execution uses the local task cwd and native thread id.
- [x] Both nodes pass full tests and structure checks after deployment.

## Shipped evidence

- Forest Mac submitted marker `REMOTE_CHANNEL_TEST_20260830` through its local workspace to MatrixBook Air over direct SSH. MatrixBook Air appended the user message to native thread `019ff6f9-21d6-7a22-b1eb-5083fcb40cf5`, resumed Codex in `/Users/matrix/333.dev/mulitca`, and persisted the assistant reply “远程通道测试成功。” with a completed turn.
- A relay-only signed request reached Forest Mac through `67.230.169.158:33699` and its loopback-forwarded owner endpoint. The valid signature passed and the owner truthfully rejected the deliberately missing thread without executing anything.
- Both owner keys and peer copies are 32-byte base64 material stored in mode-0600 files. Neither peer JSON contains action credentials.
- Real UI inspection confirmed the remote composer, owner label, destination-specific placeholder, and enabled send action in the full embedded Codex workspace.
- Final validation covered 103 tests and 110 structure-checked files with zero frozen debt.
