# Wrapper local project bootstrap repair

## Context

The dedicated wrapper intentionally owns an independent `CODEX_HOME` so its one-million-token context request does not change the ordinary Codex configuration. Native conversations and the app-server project database are allowlisted shared state, but the current desktop release also keeps a `CODEX_HOME`-local project bootstrap cache in `.codex-global-state.json`.

An older wrapper startup marked the local project migration complete while that cache was empty. The shared app-server database still contains every project, but the native project chooser fails to load and the sidebar shows only GPT cloud projects.

## Goals

- Preserve the independent wrapper profile and context configuration.
- Make ordinary local Codex projects visible in the wrapper's native project chooser.
- Copy only non-secret local-project presentation metadata; do not share browser state or credentials beyond the existing allowlist.
- Preserve wrapper-only project entries and avoid destructive deletion.
- Repair new or stale wrapper bootstrap state before launching the dedicated native app.

## Non-goals

- Reimplement the native project UI.
- Reorder native project DOM nodes.
- Share the complete global-state file or Chromium profile.
- Delete projects or mutate project files.

## Design

1. Read `.codex-global-state.json` from the ordinary and wrapper `CODEX_HOME` directories.
2. Additively merge `local-projects`; ordinary-state values win only for matching project ids so renamed roots remain current, while wrapper-only entries remain intact.
3. Copy missing legacy-to-app-server project mappings into the wrapper host namespace (`local:<wrapper CODEX_HOME>`). This reuses the already shared app-server project ids and must not create duplicate projects.
4. Copy the source migration completion marker into the wrapper host namespace and initialize the selected local project only when the wrapper has no selection.
5. Copy legacy workspace roots and labels only when the wrapper lacks them.
6. Persist with an atomic same-directory rename and mode `0600`. Invalid source or target JSON fails closed rather than overwriting state.
7. If there is no useful source project state, make no change.

## Safety invariants

- Only files below the configured source and wrapper `CODEX_HOME` paths are read or written.
- Authentication, browser cookies, account state, and Chromium storage are not copied.
- Existing wrapper-only projects are retained.
- Project directories and the shared app-server SQLite database are read-only to this repair.

## Verification

- Unit tests cover empty-wrapper repair, host-key remapping, additive preservation, no-op behavior, and invalid JSON.
- `npm run check` and `npm test` pass.
- After a wrapper-only restart, the native project chooser lists local projects including `看板`; a multi-directory project such as `PAVoice` remains represented by both roots.

