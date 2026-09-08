# ADR 0014: Rekey complete remote rollouts for native import

- Status: accepted
- Date: 2026-09-02

## Context

The app-server `thread/fork` contract preserves inherited turns logically, but
the installed desktop build writes only metadata to the child rollout and
indexes it with `has_user_event = 0`. Native project queries omit that child, so
an otherwise resumable fork renders as “暂无聊天”. Injecting a synthetic user
event would make the child visible but would corrupt the copied conversation.

## Decision

After transport verification, copy the complete rollout into the local session
tree while changing only the session metadata identity, working directory, and
thread-source marker. Allocate a fresh local UUID, preserve all subsequent
history records byte-for-byte, and ask the app server to read and index the new
thread before assigning it through `project/import`. Do not copy or edit SQLite.

On failure, delete the exact newly indexed thread through app-server and remove
only its newly created rollout. The remote rollout and remote index remain
unchanged.

## Consequences

- The imported native thread contains real user turns, appears under its native
  project, and can continue locally without a synthetic message.
- Local and remote writers remain independent because their session IDs differ.
- The adapter depends on the stable first-record `session_meta` envelope and
  fails closed if it is absent, oversized, malformed, or identifies a different
  source thread.
- All history after the first metadata line is preserved exactly.

## Rejected alternatives

- Keep using `thread/fork`: invisible in current native project queries.
- Inject an empty or duplicate user item: changes the copied conversation.
- Modify `has_user_event` in SQLite: bypasses native indexing and storage
  invariants.
