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
- `src/task-adapter.mjs`, `src/zotero-adapter.mjs`, `src/zotero-read-contract.mjs`, `src/zotero-read-metadata.mjs` — external providers and normalized Zotero read boundaries.
- `src/zotero-local-api.mjs`, `src/zotero-local-contract.mjs`, `src/zotero-write-validation.mjs`, `src/zotero-credentials.mjs` — credential-isolated Zotero write orchestration, safe protocol mapping, and allowlisted validation.
- `src/cdp-client.mjs`, `src/injector.mjs`, `src/injection.mjs`, `src/launcher.mjs` — dedicated Codex integration infrastructure.
- `src/http-server.mjs` — loopback server lifecycle and top-level route composition; bounded contexts own their handlers.
- `public/core/` — normalized browser state, DOM services, shared formatting, task loading, transport, navigation, and native frame messaging.
- `public/features/` — isolated feature rendering and interaction ownership; Zotero keeps read-only browsing separate from authorization and write editing.
- `public/app.js` — browser composition root only; it creates services and features, wires callbacks, and starts lifecycle work.

## Target web structure

```text
public/
  index.html                # synchronous document shell
  panels/                   # private server-composed feature markup
  app.js                    # bootstrap only
  core/                     # state, DOM helpers, formatting, task source, transport, navigation
  features/
    sessions/
    dispatch/
    context/
    priority/
    zotero/
```

Each feature owns its rendering, events, and view-specific formatting. Shared primitives belong in `core/`; feature-to-feature imports are avoided.

## Structural debt

The remaining frozen source debt is `public/styles.css`. It should be split by shared shell, feature layout, and Zotero/editor styling without introducing a CSS build step.
