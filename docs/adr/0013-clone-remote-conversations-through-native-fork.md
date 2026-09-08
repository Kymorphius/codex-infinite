# ADR 0013: Clone remote conversations through native fork

- Status: superseded by ADR 0014
- Date: 2026-09-01

## Context

Project portability includes conversation continuity. Copying a remote rollout
file directly into the local session tree preserves the remote UUID and creates
two writable owners. Rewriting JSONL identifiers and native SQLite rows ourselves
would depend on private storage details and bypass Codex's indexing invariants.

## Decision

Remote rollout files are verified fork inputs. The destination
Codex app server receives each file through the supported experimental
`thread/fork` path form, with the copied local directory supplied as `cwd` and
runtime workspace root. Codex creates a new local rollout and thread ID. After
all forks succeed, `project/import` binds the new IDs to one native local project.
The app server requires the input rollout to be indexed, so the verified input
is placed under the real local Codex session root. Codex records the source ID
as the fork parent and consequently requires that parent to remain. The source
entry is therefore archived as a read-only lineage anchor; only the new fork is
assigned to the visible project. On a failed batch, new forks are deleted first,
then the source anchors are deleted.

The remote originals stay owned and writable only by their original node. An
active remote conversation blocks cloning. Failed batches delete any local
forks and anchors already created and never edit or remove remote state.

## Consequences

- Local and remote copies can diverge safely because their IDs and rollouts are
  distinct.
- Import depends on the app-server `thread/fork(path)` and `project/import`
  contracts and must fail closed when the installed Codex build lacks them.
- Rollout inputs require private staging, bounded size, SHA-256 verification,
  and an archived parent anchor of approximately the source history size for
  every retained fork.
- Forking is not bit-for-bit storage replication; Codex remains responsible for
  normalizing the new local thread and its index records.

## Rejected alternatives

- Copying rollouts and SQLite rows verbatim: duplicate writer identity and
  unsupported database mutation.
- Rewriting JSONL UUIDs ourselves: incomplete internal-reference coverage and
  version fragility.
- Moving ownership instead of copying: contradicts the requested additive copy
  and would make the Windows source read-only or unavailable.
