# Current thread project membership

- Status: shipped
- Owner: Codex Control Console
- Date: 2026-09-01
- Related ADRs: none

## Problem

Session rollout metadata records the working directory that existed when a
thread was created. Native ChatGPT can later move that thread into a project,
change its current working directory, rename the project, or associate several
roots and worktrees with one project. The control console currently continues
grouping by the immutable rollout directory while labeling from newer project
state. This can hide a moved thread under its former temporary project and can
render several rows with the same display name.

## Goals

- Overlay indexed rollout tasks with the current thread working directory and
  project membership from `state_5.sqlite`.
- Resolve project membership by explicit `threads.project_id` first and by the
  deepest matching `project_roots.path` when the explicit id is absent.
- Carry a bounded optional `projectId` through the federated snapshot contract.
- Group remote-sidebar projects by current project id, merging a project's main
  root, additional roots, and worktrees without merging unrelated namesakes.
- Keep rollout metadata as a safe fallback whenever current state is absent,
  incompatible, locked, or unreadable.

## Non-goals

- Modifying native projects, roots, threads, or SQLite files.
- Inferring project identity from display-name equality.
- Rewriting rollout JSONL metadata.
- Merging unrelated projects that happen to share a name.

## Design

`CurrentThreadProjectIndex` opens the source Codex SQLite database read-only.
It reads only the bounded thread ids already selected by `CodexTaskAdapter`,
plus the bounded project/root projection needed to resolve membership. Each
result contains a sanitized current cwd, project id, and project name.

The task adapter applies that projection before deriving its directory project
key and display label. The optional project id is exposed through the existing
schema-v3 peer task object. Older peer snapshots remain valid and continue to
fall back to cwd grouping.

The native remote sidebar uses `projectId` as its group key when present and cwd
otherwise. It never groups solely by display name. Project weighting and
newest-first conversation ordering remain unchanged.

## Safety

- SQLite is opened with `readOnly: true`; no statement mutates native state.
- Thread ids, query parameter counts, paths, ids, and names are bounded.
- Read failures degrade to the existing rollout-derived projection.
- Database paths and rollout paths do not cross the peer boundary.

## Acceptance criteria

- [x] A thread moved after creation appears under its current native project.
- [x] Multiple roots belonging to one project produce one remote-sidebar row.
- [x] Unrelated same-name projects remain distinct.
- [x] Missing or unreadable current state preserves existing rollout behavior.
- [x] Federated snapshots preserve the optional bounded project id.
- [x] Full tests and structure checks pass without a budget increase.

## Shipped evidence

- The live Windows snapshot resolved thread
  `01a05cc2-a041-7da3-bc6d-4fecf184d05c` from its original temporary rollout
  directory to `D:\333.开发\真仙幸存者` and project `真仙幸存者`.
- Three migrated native project records shared the same Windows roots. The
  read-only projection selected one stable project family and merged its main
  root, additional roots, and worktree into one `联动资产管理` row with 40
  conversations.
- The live macOS sidebar contained one remote root, reported Windows online,
  displayed `真仙幸存者`, and reduced the Windows projection from 38 duplicate
  directory groups to 29 current project groups.
- All 274 tests passed. Syntax and structure checks passed for 184 and 202 files
  respectively with zero frozen debt.
