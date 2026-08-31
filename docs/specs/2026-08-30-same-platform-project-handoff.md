# Same-platform project and conversation handoff

- Status: proposed
- Owner: Codex Control Console
- Date: 2026-08-30
- Initial platforms: macOS to macOS
- Related ADRs: `docs/adr/0001-federated-nodes-through-relay.md`, `docs/adr/0002-owner-routed-conversation-access.md`

## Problem

Cross-node viewing does not make a project portable. A user must be able to move a selected project from one Mac node to another with its directory tree and selected native Codex conversations, then continue working from the destination. Blindly synchronizing live session files would create two writers and ambiguous ownership; blindly overwriting an existing project path could destroy local work.

## Goals

- Copy a selected project directory completely between trusted macOS nodes, preserving its requested absolute path when safe.
- Preflight source, destination, free space, platform compatibility, active work, Git state, symlinks, and conflicts before copying.
- Support an initial one-way handoff between MatrixBook Air and MacBook Pro over direct SSH.
- Transfer selected conversation continuity only through an explicit ownership handoff.
- Verify file and conversation integrity before offering “在目标节点继续”.

## Non-goals for the first increment

- No continuous bidirectional filesystem sync, multi-writer conversations, cross-platform path translation, public relay file storage, credential copying, or automatic deletion of the source.
- No overwrite or `--delete` behavior on a non-empty destination.
- No copying of `auth.json`, global Codex configuration, SSH keys, caches, or machine-specific credentials.

## Terminology

- **Copy**: create a verified destination project while the source remains authoritative.
- **Handoff**: quiesce a selected conversation, copy and verify its portable state, then transfer write ownership to the destination. The source keeps a read-only record.
- **Sync**: a later repeated file reconciliation operation. It is not conversation multi-writing.

## Proposed workflow

1. The user chooses one project, source node, destination node, and destination path. For the first two Macs, the default is the same absolute path because both use `/Users/matrix`.
2. Both nodes run a read-only preflight. The destination must be absent or empty for the first release. Any active destination project, path type mismatch, insufficient space, unsafe symlink escape, or uncommitted conflicting tree blocks the operation.
3. The source produces a bounded manifest of relative paths, types, sizes, modes, modification times, and content hashes. Credentials and configured exclusions are identified before transfer.
4. Direct SSH performs an incremental, resumable one-way copy into a sibling staging directory on the destination. The final path is not modified during transfer.
5. The destination verifies the manifest. A same-filesystem rename promotes the staging directory only after verification; an existing destination is never replaced.
6. Conversation handoff, when selected, waits for the owner turn to become idle, seals a final activity checkpoint, transfers only the required native conversation artifacts, validates the destination index, and atomically changes the federation owner record.
7. The destination opens the project and conversation in its local native Codex. The source copy remains intact until the user separately chooses archival or cleanup.

## Safety invariants

- Project transfer and conversation ownership transfer are separate transactions with separate status.
- Native conversation files have exactly one writable owner.
- The operation is additive by default; rollback removes only the newly created staging tree or returns ownership before destination work begins.
- Paths are absolute, normalized, inside an explicitly selected source root, and never constructed from untrusted remote output.
- File bodies travel point-to-point over authenticated SSH in the first release. The relay may carry control/status only until a separately authenticated streaming transport is designed.
- Prompts, source contents, credentials, and manifests never enter browser persistence, URLs, or process command lines.

## Open investigations

- Determine the minimum native Codex session/index artifacts required for a supported import on the same Codex build.
- Determine how active worktrees and project-level multi-directory attachments should map at the destination.
- Measure macOS metadata requirements: permissions, executable bits, symlinks, extended attributes, hard links, and case sensitivity.
- Define resumable hashing and staging cleanup without increasing the source-file structure budget.

## Acceptance criteria for implementation

- A dry run explains exactly what will be copied, excluded, blocked, and preserved.
- An existing non-empty destination fails closed without modification.
- Interrupted transfer resumes or rolls back the staging directory without affecting source or final destination.
- Manifest verification detects missing, changed, truncated, and type-mismatched entries.
- Conversation handoff cannot complete while either node believes it is writable on both sides.
- A verified project and selected conversation open in the destination native Codex at the requested path.
- Full tests, structure checks, and a real two-Mac transfer fixture pass before enabling the UI action.
