# CSS modularization

- Status: shipped
- Owner: Codex Control Console
- Date: 2026-08-30

## Problem and goals

`public/styles.css` is the final frozen source-debt file. It combines the shared application shell, task and dispatch views, session and priority views, shared state components, Zotero browsing and editing, and every responsive rule in one 272-line file.

Split the stylesheet by responsibility without adding a build step, changing public behavior, weakening the static-asset allowlist, or altering the existing cascade order.

## Design

The document loads six exact allowlisted stylesheets in this order:

1. `public/styles/base.css` owns reset, typography, navigation, shell, buttons, common cards, metrics, and section headings.
2. `public/styles/tasks.css` owns task board, dispatch, context, form, and task-card presentation.
3. `public/styles/sessions-priority.css` owns session hierarchy and project-priority presentation.
4. `public/styles/states.css` owns empty/loading states, visibility helpers, toast, and screen-reader-only text.
5. `public/styles/zotero.css` owns Zotero browsing and editor presentation.
6. `public/styles/responsive.css` owns all existing media-query overrides.

The rules remain byte-for-byte equivalent within each extracted range, and the links preserve the original range order. There is no CSS importer or runtime template fetch. `src/static-assets.mjs` remains the sole public-path allowlist and individual stylesheet paths are exact matches.

## Safety and compatibility

- Loopback binding, exact-origin mutation checks, credential isolation, and read-only session indexing are unchanged.
- The obsolete monolithic `/styles.css` route is removed rather than retained as an untracked compatibility path.
- All styles remain same-origin and compatible with the current content security policy.

## Acceptance

- [x] Six focused stylesheets load in the original cascade order and the old path is unavailable.
- [x] Static asset tests cover every stylesheet and reject unknown or traversal paths.
- [x] Structure checks report zero frozen debt files.
- [x] Full tests pass and all six UI modules remain visually and functionally available after restarting only the dashboard service.

## Shipped evidence

- Rejoining the six extracted files produced an exact match with the previous 29,485-character stylesheet source.
- Syntax and structure checks passed across 94 tracked files and reported zero frozen debt files; the full 84-test suite passed.
- After restarting only the dashboard process, the browser loaded all six stylesheets in order and rendered all six modules. Live data showed 160 sessions across 19 project groups, 16 priority cards, and 2,337 Zotero items with 24 on the current page.
- Every new stylesheet returned `200 text/css`; the obsolete `/styles.css` route returned 404.
