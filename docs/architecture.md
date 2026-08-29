# Architecture

## Product boundaries

Codex Control Console is a loopback-only companion embedded into a dedicated Codex desktop profile. It indexes shared native sessions, opens native conversations, schedules work, exposes context controls, ranks projects, and bridges Zotero without becoming a second chat system.

The following are invariants:

- Native Codex remains the owner of conversations and project state.
- Session indexing is read-only.
- HTTP and CDP listeners bind only to `127.0.0.1`.
- Mutations require the exact dashboard origin.
- Credentials never enter browser state, URLs, logs, or API responses.
- Remote devices must enter through an authenticated provider boundary, not direct filesystem assumptions in the UI.

## Dependency direction

```text
composition root
  ├─ application services
  │    ├─ domain policies and normalized contracts
  │    └─ provider interfaces
  ├─ infrastructure adapters (filesystem, CDP, process, HTTP, Zotero)
  └─ web UI modules (rendering and user interaction)
```

Dependencies point inward. Domain policies do not import HTTP, DOM, filesystem, CDP, or process modules. Adapters translate external formats into normalized contracts. The web UI does not parse native session files or credential formats.

## Current module ownership

- `src/main.mjs` — composition root and lifecycle only.
- `src/board.mjs`, `src/priority.mjs` — pure derived domain views.
- `src/context-window.mjs`, `src/dispatch-board.mjs` — application state and policies.
- `src/context-http.mjs`, `src/dispatch-http.mjs`, `src/tasks-http.mjs`, `src/zotero-http.mjs` — bounded-context HTTP route orchestration.
- `src/http-utils.mjs`, `src/static-assets.mjs` — shared loopback transport primitives and allowlisted public assets.
- `src/task-adapter.mjs`, `src/zotero-adapter.mjs`, `src/zotero-local-api.mjs` — external providers.
- `src/cdp-client.mjs`, `src/injector.mjs`, `src/injection.mjs`, `src/launcher.mjs` — dedicated Codex integration infrastructure.
- `src/http-server.mjs` — loopback server lifecycle and top-level route composition; bounded contexts own their handlers.
- `public/` — embedded web client. It should evolve toward feature modules rather than a single application script.

## Target web structure

```text
public/
  app.js                    # bootstrap only
  core/                     # state, DOM helpers, transport, module navigation
  features/
    sessions/
    dispatch/
    context/
    priority/
    zotero/
```

Each feature owns its rendering, events, and view-specific formatting. Shared primitives belong in `core/`; feature-to-feature imports are avoided.

## Structural debt and extraction order

1. Split `public/app.js` by feature, beginning with sessions and Zotero.
2. Split `public/index.html` into feature templates only if native modules or a build-free template loader can preserve startup reliability.
3. Extract Zotero read queries/mapping from `src/zotero-adapter.mjs`.
4. Extract Zotero request protocol and payload validation from `src/zotero-local-api.mjs`.
5. Split `scripts/inspect.mjs` into host, iframe, and evidence helpers.

This order reduces the largest change surface first without changing product behavior.
