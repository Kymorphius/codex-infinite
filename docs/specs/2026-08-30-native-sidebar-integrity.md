# Native sidebar integrity

- Status: Implemented
- Owner: Codex Control Console
- Date: 2026-08-30

## Problem

The wrapper intentionally uses an independent Chromium profile and an independent `CODEX_HOME` configuration so regular conversations can request a one-million-token context window without changing the ordinary Codex configuration. Shared native state is present, but the injection layer also reordered React-owned project-list DOM children. The newer desktop UI introduced a collapsible `Projects` section and a separate “展开显示” control, invalidating the older structural assumptions. After native redraws this produced missing-looking projects, duplicate entries, and an incorrectly positioned expansion control.

## Goals

- Preserve the independent wrapper profile and million-context configuration.
- Let native ChatGPT/Codex exclusively own GPT workspace and Codex project rendering, expansion, ordering, and pin state.
- Keep project ranking in the control console's own read-only “项目优先级” view.
- Preserve existing shared session/project state and all safety boundaries.

## Non-goals

- Merge the ordinary and wrapper Chromium profiles.
- Copy cookies, tokens, Local Storage, or profile databases.
- Reimplement native projects inside the injected sidebar.
- Change the priority scoring algorithm.

## Design

1. Remove project-order polling from `CodexInjector`.
2. Remove native project-list discovery, name parsing, rank attributes, and DOM `append` reordering from the injected script.
3. Keep the MutationObserver only for installing and restoring the control-console entry points.
4. Prepare CSP bypass on the loopback CDP page before injection and never force `Page.reload`; desktop build `26.825.51511` can stall or show its startup failure fallback when an external reload interrupts native initialization.
5. Keep the independent `Codex Control Console` Chromium profile and `~/.codex-control-console/config.toml` with the million-context request.
6. Continue sharing the explicitly allowlisted Codex state entries so a clean wrapper restart can reload native projects without copying credentials or browser state.

## Safety

- No profile, cookie, token, or browser database is copied or inspected.
- Native Codex remains the only owner of project and conversation state.
- Loopback-only networking, exact-origin mutations, credential isolation, signed peer actions, and read-only session indexing are unchanged.

## Acceptance criteria

- The injected source contains no project-order callback, rank marker, or native project DOM move.
- The injector prepares CSP once per connection before evaluating the injected source and does not call `Page.reload`.
- The wrapper retains its independent profile and one-million-token configuration.
- After a clean wrapper restart, native projects render without injection-created duplicates and the native “展开显示” control remains native-owned.
- `npm run check` and `npm test` pass.

## Verification

- [x] Injection regression test rejects project-order and rank code.
- [x] Independent runtime reloaded shared native project state after a wrapper-only restart.
- [x] Final live inspection expanded the new native `Projects` section and found 35 project items, injection version `2026-08-30.6`, zero rank markers, and no project-order hook. Repeated visible labels have distinct native `g-p-*` project ids and are native data rather than cloned DOM nodes.
