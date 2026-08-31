# Architecture

## Product boundaries

Codex Control Console is a loopback-only companion embedded into a dedicated Codex desktop profile. It indexes shared native sessions, opens native conversations, schedules work, exposes context controls, ranks projects, and bridges Zotero without becoming a second chat system.

The following are invariants:

- Native Codex remains the owner of conversations and project state.
- Session indexing is read-only.
- HTTP and CDP listeners bind only to `127.0.0.1`.
- Mutations require the exact dashboard origin.
- Infrastructure credential material—SSH private keys, node signing keys, Codex
  authentication stores, and browser cookies—never enters browser state, URLs,
  logs, or API responses. Trusted-node execution transcripts are arbitrary
  user/process content and may contain incidental secrets under ADR 0008; the
  console never reads credential stores to produce them.
- Remote devices must enter through an authenticated provider boundary, not direct filesystem assumptions in the UI.
- Every node's complete native Codex desktop app remains its execution runtime;
  auxiliary protocols must not silently replace desktop-hosted capabilities.

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
- `src/peer-contract.mjs`, `src/peer-config.mjs`, `src/ssh-peer-adapter.mjs`, `src/federated-task-adapter.mjs` — trusted node definitions, local-only snapshot/activity contracts, adaptive direct/relay SSH transport, and owner-routed aggregate read views.
- `src/approval-contract.mjs` — pure bounded contract for owner-issued approval
  capabilities; only one-turn acceptance and denial cross the node boundary.
- `src/execution-transcript.mjs` — pure, bounded full-fidelity projection and
  peer validation for allowlisted native execution records.
- `src/conversation-activity.mjs`, `src/activity-http.mjs` — bounded native
  message/lifecycle projection, exact allowlisted execution detail, and
  pending-approval projection with explicit owning-device HTTP routing.
- `src/peer-action-auth.mjs`, `src/peer-action-http.mjs`, `src/remote-message-service.mjs` — credential-isolated action signing/replay protection, local/owner mutation routes, and single-owner native thread coordination.
- `src/native-approval-injection.mjs`, `src/native-conversation-adapter.mjs` —
  loopback desktop boundary for passively retaining live App Server approval
  requests, reading revisioned native drafts, opening the owner task, and
  applying exact owner-routed actions through native Codex.
- `src/node-runtime.mjs` — normalized owner-runtime capability contract and cached
  native-host health policy; it describes routing without claiming feature installation.
- `src/zotero-local-api.mjs`, `src/zotero-local-contract.mjs`, `src/zotero-write-validation.mjs`, `src/zotero-credentials.mjs` — credential-isolated Zotero write orchestration, safe protocol mapping, and allowlisted validation.
- `src/cdp-client.mjs`, `src/injector.mjs`, `src/injection.mjs`, `src/launcher.mjs` — dedicated Codex integration infrastructure.
- `src/http-server.mjs` — loopback server lifecycle and top-level route composition; bounded contexts own their handlers.
- `src/dashboard-handlers.mjs` — ordered bounded-context handler registry used by the loopback server.
- `src/health-http.mjs`, `src/tasks-http.mjs` — health and aggregate/local-only node snapshot route ownership.
- `public/core/` — normalized browser state, DOM services, shared formatting, task loading, transport, navigation, and native frame messaging.
- `public/features/` — isolated feature rendering and interaction ownership;
  session approval models/controllers are separate from conversation rendering,
  and Zotero keeps read-only browsing separate from authorization and write editing.
- `public/app.js` — browser composition root only; it creates services and features, wires callbacks, and starts lifecycle work.

## Target web structure

```text
public/
  index.html                # synchronous document shell
  panels/                   # private server-composed feature markup
  styles/                   # ordered shared, feature, integration, and responsive styles
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

All previously frozen source debt has been decomposed. New modules remain subject to the automated structure budget; budget increases require an ADR.
