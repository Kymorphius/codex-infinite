# Verified multi-root project clone

## Intended operation

Clone an explicitly selected set of project roots from a trusted same-platform
Mac peer into identical local absolute paths. The user may omit a broad parent
root: omitted sibling content must not be transferred. Keep project data and .git,
including uncommitted files, sparse files, hardlinks and symlink targets. Do not
follow symlinks. Skip only the exact live Git fsmonitor IPC socket, not file trees.
Existing destinations block promotion. Stage each new root on the target volume,
verify contents, and promote it without modifying any remote file.

## Complete history

Use the owning native project's explicit membership and the transitive closure of
subagent parent links, not the limited recent-task snapshot and not every session
that happens to use the parent directory. Include archived members. Index metadata
read-only and copy the complete rollout files. Record source sizes and SHA-256
hashes, detect concurrent source changes, and retain a private operation receipt.

Allocate a stable new UUID per copied session in the operation receipt. Rewrite the leading session_meta identity, parent/fork IDs inside the selected
graph, local work directory, and copy provenance. Preserve v2 shared session_id
relationships instead of assigning each child its own root session identity.
For paginated history, also map only payload.thread_id on event_msg and
token_usage_record records. Patch these JSON value spans without reserializing
messages, tool output, whitespace, or nested user data. Keep every other body byte.
Session bodies may contain historical original IDs; the receipt maps old to new
without rewriting user text or historic tool outputs. Retain the complete original
rollouts and source hashes alongside native-body hashes in private clone storage.
Native working-directory
settings may append only validated thread_settings_applied records after the
mapped body; validate these appended settings records separately. For old worktrees omitted
from the selected file roots, use the selected main project directory as the new
working directory; retain the original cwd in the receipt. Keep original cwd when
it remains a selected root or their local parent. No remote ownership transfer.

Use native app-server reads/import/metadata calls to index copies and bind the
selected roots as one new local project. Resume each unarchived main conversation
without starting a turn, then read its paginated history to prove content is
accessible. A fork whose entire source ordinal range precedes its native
subagent_history_start_ordinal legitimately has no visible new turns; verify this
against source metadata instead of fabricating a turn or rejecting the copy.
Keep v2 children linked to their parent; they cannot all be resumed
independently, which must not become an import failure. Preserve titles and archived
state; an already-archived copy is inspected without unarchiving it. Keep
subagent relationships; do not turn subagents into top-level sidebar entries.
Never write/copy SQLite or copy account credentials. Extend the native legacy
sidebar registry to accept all selected roots, preserving the single-root API.

## Reliability and validation

The operation must be resumable with a private receipt, explicit source-to-local
IDs, and per-session verified/indexed state. Source staging is preserved until
native verification completes. Before retrying, validate any existing owned output
rather than overwriting it. Do not delete copied project roots because later
history indexing failed. Large rollout copying/hashing is streaming and bounded.

Check multi-root registry matching, deterministic graph mapping, byte-preserving
history copy, metadata rewriting, source hash mismatch, duplicate destinations, native home
path aliases and appended working-directory settings,
resume behavior, and native import payloads. Run repository check/tests before
committing the owned changes. Delivery distinguishes file verification, historical
byte integrity, native indexing, and desktop visibility.
