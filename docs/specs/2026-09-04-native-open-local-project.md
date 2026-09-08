# Native open-local-project entry

- Status: Implemented
- Owner: Codex Control Console
- Date: 2026-09-04

## Problem

The native desktop still supports creating a local project from a directory,
but the action is currently exposed only as an unlabeled icon beside the
Projects section. The formerly prominent entry is therefore easy to miss in
both Finder-based macOS use and Explorer-based Windows use.

## Goals

- Restore a visible native-sidebar action for opening a local project.
- Use Finder on macOS and File Explorer on Windows through the native Codex
  project flow.
- Keep native Codex as the owner of directory selection and project state.
- Keep the entry idempotent across native route redraws and injector polling.

## Non-goals

- Read project directories in the renderer or control console server.
- Reimplement the native project picker.
- Create or mutate native project records directly.
- Change project ordering, expansion, or pin state.

## Design

Install a bounded presentation bridge beside the native New chat action. The
entry is labelled `打开本地项目` and has platform-specific help text. On
activation it invokes the existing native Add project action. It then selects
the native Local project type and advances to the native directory picker when
those controls are present. If the native flow changes, it leaves the native
dialog open instead of fabricating project state.

The bridge is a separate injection module and is installed in both the
dedicated wrapper and the optional primary-owner bridge. A MutationObserver
only restores the bridge after native redraws; it never moves native project
rows.

## Safety

- Directory selection remains in the native desktop process.
- No filesystem path crosses the dashboard HTTP boundary.
- Existing loopback, exact-origin, credential, and read-only indexing
  invariants are unchanged.

## Acceptance criteria

- A visible `打开本地项目` action appears beneath the native New chat action.
- macOS help text names Finder and Windows help text names File Explorer.
- Activating the action delegates to the native Add project flow and chooses
  the Local project type when available.
- Repeated installation produces one entry and route redraws restore it.
- `npm run check` and `npm test` pass.

## Verification

- [x] Unit tests cover platform labels, native delegation, local selection,
  idempotency markers, and syntactic validity of the injected source.
- [x] Live macOS inspection reaches the native source-folder chooser from the
  restored entry and exposes Finder-specific help text.
- [ ] Live Windows inspection opens the native File Explorer directory picker.
- [x] `npm run check` and `npm test` pass (342 tests).
