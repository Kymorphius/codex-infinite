# Current project display names in Session Center

- Status: shipped
- Owner: Codex Control Console
- Date: 2026-08-31

## Problem

Session metadata stores a working directory, and the task adapter currently
derives `project` from that directory's final segment. After a user renames a
native Codex project, Session Center therefore continues to show the old folder
name. Multi-root projects and Codex worktrees can also display a child folder or
worktree checkout name instead of the current native project name.

## Goals

- Resolve each local session's display name from the current read-only native
  project state using the longest containing configured root.
- Recognize a Codex worktree by its checkout basename when that basename maps
  unambiguously to a configured project root.
- Carry the bounded display name through the existing peer snapshot so every
  node shows the owner device's current project name.
- Preserve the existing derived `project` value as the stable dispatch and
  routing key.

## Non-goals

- Mutating or renaming native projects.
- Rewriting historical session records or scheduled dispatches.
- Sending native project-state files or project IDs to peer browsers.

## Design

- A filesystem adapter reads `.codex-global-state.json` and exposes only a
  normalized `nameFor(cwd)` lookup.
- `CodexTaskAdapter` reads one lookup snapshot per task refresh and adds
  `projectDisplayName`; failures fall back to the existing derived project.
- The peer contract validates the optional bounded display name.
- Session Center groups and labels directories with `projectDisplayName` while
  dispatch, board, and owner routing continue to use `project`.
- Windows paths compare case-insensitively; POSIX paths remain case-sensitive.

## Acceptance criteria

- [x] A project renamed independently of its folder displays its new name.
- [x] A multi-root project displays one current name for all configured roots.
- [x] A recognized worktree displays its owning project's current name.
- [x] Unknown and malformed project state fail closed to the folder-derived
  name.
- [x] Remote snapshots carry only the bounded display name, not project-state
  paths or IDs.
- [x] Existing dispatch/routing keys remain unchanged.
- [x] `npm run check` and `npm test` pass without a budget increase.

## Verification

- Unit tests cover direct roots, longest-root selection, multi-root projects,
  Windows path case folding, worktrees, malformed state, and fallback behavior.
- Adapter and peer tests prove `project` remains stable while
  `projectDisplayName` changes.
- Real-node snapshots verify renamed projects on all three devices.

## Shipped evidence

- The live three-node snapshot reports `/Users/matrix/333.dev/mulitca` with
  stable project key `mulitca` and current display name `看板`.
- The same snapshot reports `/Users/matrix/333.dev/chatgptbox` with stable
  project key `chatgptbox` and current multi-root display name `devspace`.
- Windows nested roots also resolve to their current owner project names.
- All 238 tests and the 169-file syntax / 187-file structure checks pass with
  zero frozen debt.
