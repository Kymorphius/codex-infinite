# ADR 0021: Preserve the history graph for multi-root project clones

- Status: accepted
- Date: 2026-09-10

## Decision

A bounded same-platform clone operation transfers explicitly selected roots and
rekeys all project-member and descendant-subagent rollouts. It preserves body
bytes as in ADR 0014 except for the exact transport identity values required by
paginated history: payload.thread_id in event_msg and token_usage_record. These
values and the leading metadata's fork/parent references map to stable cloned IDs.
V2 children keep the mapped shared root session_id. No message/tool-output text
is rewritten; original rollouts and hashes are retained. A private receipt records IDs, original cwd and hashes.
Only root project members are registered as native sidebar members. Project roots
are registered together in original selected order.

Unlike the initial Windows adapter, the same-platform transfer preserves symbolic
links as links, sparse files and hardlinks without traversing link targets. Native
IPC sockets cannot be cloned and are explicitly excluded by exact path. This does
not change the Windows HTTP copy contract or any ownership/network boundary.

## Consequences

A large project is not truncated to recent conversations or one root. Copies can
resume after partial indexing without duplicating conversations. Omitted worktrees
use the selected main root for future work; historic body content stays unchanged.
Native thread settings persist a mapped working directory when old turn contexts
would otherwise restore an omitted worktree. These native settings records may
follow the unchanged mapped history, which is separately hashed and verified. Unarchived main histories
are opened and paginated through the native API to catch indexing that otherwise
returns metadata but no messages.
Source databases are only read, never copied or edited. Project file promotion is
independent from history registration, so a later native error cannot destroy a
successfully verified copied working tree.
