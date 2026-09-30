# Architecture

## Product boundaries

Codex Control Console is a loopback-only companion embedded into a dedicated Codex desktop profile. It indexes shared native sessions, opens native conversations, schedules work, exposes context controls, ranks projects, and bridges Zotero without becoming a second chat system.

Managed terminal conversations are a first-class conversation provider alongside
native Codex and ChatGPT. The local provider owns persistent conversation metadata
and explicit project references under wrapperCodexHome. Native project/sidebar and
conversation-tab modules project these records without writing native databases.
The existing main-area host displays a single terminal conversation and composer;
there is no nested terminal management workspace in this view.

Stable conversation IDs are separate from transient PTY IDs. Opening a record does
not start a process. Creating or explicitly starting does; closing a tab and
archiving do not stop it. Shell output remains bounded in memory. Claude uses its
own stable CLI session ID and only resumes a verified transcript. The full terminal
and composer share the same single-controller exact-origin transport.

TaskCenter remains the only todo authority. Assignment identity includes provider,
physical device and conversation ID. Terminal claims require manual input and never
enter native Codex queue delivery, model settings or native thread routes.

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
- `src/terminal-contract.mjs`, `src/terminal-process.mjs`,
  `src/terminal-service.mjs`, `src/terminal-http.mjs`,
  `src/terminal-websocket.mjs` — bounded terminal contracts, owned local PTYs,
  single-controller connections, and exact-origin HTTP/WebSocket transport.
  `src/terminal-assets.mjs` registers only the pinned browser runtime assets.
- `public/features/terminal/index.js`, `presentation.js`, and `session.js` —
  terminal conversation layout, per-session composer state, and xterm input /
  display adapter. Composer controls and native terminal input share the same
  ready-gated socket; they never send messages through the Codex task bridge.
- `src/router-interaction-client.mjs`, `src/native-claude-interaction-binding.mjs`,
  `src/native-claude-interactions.mjs` — caller-authenticated, process-local Claude
  questions/approvals from Router to the owning native composer. The backend keeps
  credentials; the binding checks native top-frame and current thread on every
  action. User answers return to the original CLI control channel, never a new turn.
- `src/claude-mirror.mjs`, `src/claude-mirror-turn.mjs`, `public/features/terminal/mirror.js` — live
  read-only mirror of a companion Claude transcript and one-shot `claude -p --resume` turns sent from it
  (no process keeps holding the session; see docs/specs/2026-09-29-claude-companion-mirror.md).
- `src/claude-companion-source.mjs` — read-only adapter over Router's public
  `claude-companions/<thread>/session.json`; companion sessions are adopted as
  Claude terminal records (`companionOf`) and shown under their Codex thread.
  Codex turns (`sdk-cli` holders) make them read-only and are never taken over.
- `src/claude-terminal-settings.mjs`, `src/claude-transcript-settings.mjs`,
  `src/terminal-input-line.mjs` — pure model/effort catalog, launch flags, slash
  command steps, transcript read-back rule and input-line safety rule for Claude
  terminal conversations. `src/claude-terminal-settings-apply.mjs` types queued
  choices into an idle, clean Claude PTY; `src/native-terminal-model-picker.mjs`
  and its style module are the composer UI (see the 2026-09-29 spec and ADR).
- `src/board.mjs`, `src/priority.mjs`, `public/core/project-priority.js` — pure
  derived domain views and the browser-compatible shared priority policy.
- `src/context-window.mjs`, `src/dispatch-board.mjs` — application state and policies.
- `src/generator-contract.mjs`, `src/generator-store.mjs`,
  `src/generator-service.mjs`, `src/generator-http.mjs` — bounded generator
  definitions, one-shot/manual trigger claims, crash-safe dispatch materialization,
  run projection, and exact-origin loopback transport.
- `src/dispatch-audit.mjs` — bounded append-only dispatch attempt history; the
  dispatch snapshot remains authoritative and the audit is never replayed.
- `src/experiment-contract.mjs`, `src/native-experiment-adapter.mjs`,
  `src/experiment-service.mjs`, `src/experiments-http.mjs` — read-only live
  native experiment and console extension inventory, normalized per device
  and federated through existing authenticated SSH transports.
- `src/runtime-diagnostics.mjs`, `src/diagnostics-http.mjs` — passive normalized
  readiness checks and their read-only loopback transport.
- `src/context-http.mjs`, `src/dispatch-http.mjs`, `src/tasks-http.mjs`, `src/zotero-http.mjs` — bounded-context HTTP route orchestration.
- `src/http-utils.mjs`, `src/static-assets.mjs` — shared loopback transport primitives and allowlisted public assets.
- `src/task-adapter.mjs`, `src/current-project-names.mjs`, `src/zotero-adapter.mjs`, `src/zotero-read-contract.mjs`, `src/zotero-read-metadata.mjs` — external providers, read-only current-project display-name resolution, and normalized Zotero read boundaries.
- `src/peer-contract.mjs`, `src/peer-config.mjs`, `src/ssh-peer-commands.mjs`, `src/ssh-peer-adapter.mjs`, `src/federated-task-adapter.mjs` — trusted node definitions, local-only snapshot/activity contracts, fixed POSIX/Windows peer commands, adaptive direct/relay SSH transport, and owner-routed aggregate read views.
- `src/skill-contract.mjs`, `src/local-skill-adapter.mjs`,
  `src/skill-config-store.mjs`, `src/ssh-peer-skills.mjs`,
  `src/skill-sync-service.mjs`, `src/skills-http.mjs` — bounded personal and
  repository Skill catalogs and packages, task-index-derived project discovery,
  narrow native Codex enablement configuration, atomic backup/install, peer
  transport, explicit multi-device coordination, and loopback/signed HTTP
  boundaries.
- `src/project-copy-contract.mjs`, `src/windows-project-copy-adapter.mjs`,
  `src/project-copy-service.mjs`, `src/project-copy-http.mjs`,
  `src/native-project-import-adapter.mjs` — fail-closed
  remote-project selection, stdin-only Windows manifest inspection, SFTP
  staging transport, verified local promotion, native fork/import conversation
  cloning, and exact-origin HTTP workflow.
- `src/project-identity-store.mjs`, `src/local-project-identity-adapter.mjs`,
  `src/project-sync-links.mjs` — device-owned shared project identity mappings,
  expected-identity writes and verified cross-device association. These are
  advisory checkout references; native projects and task ownership stay separate.
- `src/project-sync-contract.mjs`, `src/project-sync-service.mjs`,
  `src/local-project-sync-adapter.mjs`, `src/project-sync-git*.mjs`,
  `src/ssh-project-sync-adapter.mjs`, `src/project-sync-peer-commands.mjs`,
  `src/project-sync-http.mjs`, `src/project-sync-runtime.mjs` — explicit
  device/project selection, version-bound previews, Git-object staging and
  fast-forward application, signed node transport and exact-origin browser
  routes. Code synchronization does not transfer native task ownership.
- `src/project-replica-service.mjs`, `src/local-project-replica-adapter.mjs`,
  `src/project-replica-path.mjs`, `src/native-project-registration.mjs` — explicit
  new checkout creation in configured parents, exclusive directory creation,
  preserved failure receipts and live native project registration with independent
  readback. The coordinator owns no filesystem or native runtime details.
- `src/conversation-continuation-service.mjs`, `src/local-conversation-continuation-adapter.mjs`,
  `src/conversation-continuation-package.mjs`, `src/native-conversation-continuation.mjs` —
  explicit idle conversation copies between associated identical Git snapshots,
  bounded read-only rollout packages, stable new native identities and recoverable
  existing-project import. Copying does not transfer source write ownership or start a turn.
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
- `src/chatgpt-project-move-contract.mjs`,
  `src/native-chatgpt-project-adapter.mjs` — pure fail-closed policy and the
  loopback CDP adapter that invokes an exact native ChatGPT project-menu action
  by stable conversation/project IDs and verifies native project ownership.
- `src/node-runtime.mjs` — normalized owner-runtime capability contract and cached
  native-host health policy; it describes routing without claiming feature installation.
- `src/zotero-local-api.mjs`, `src/zotero-local-contract.mjs`, `src/zotero-write-validation.mjs`, `src/zotero-credentials.mjs` — credential-isolated Zotero write orchestration, safe protocol mapping, and allowlisted validation.
- `src/cdp-client.mjs`, `src/injector.mjs`, `src/injection.mjs`,
  `src/native-csp-bypass.mjs`, `src/launcher.mjs`, `src/desktop-host.mjs` —
  dedicated Codex integration infrastructure, target-scoped CSP preparation, and
  platform-specific desktop hosting.
- `src/native-dashboard-launch.mjs` — macOS ChatGPT 26 compatibility adapter;
  validates a fixed module contract and raises the installed standalone dashboard
  without granting the renderer arbitrary process or URL launch capability.
- `src/native-conversation-tabs.mjs` — ephemeral native-shell tab state and
  bounded presentation injection; native routes and owner-routed readers remain
  owned by their existing adapters.
- `src/native-sidebar-labels.mjs` — bounded read-only sidebar decoration for
  current project and execution-device labels; native ordering, navigation,
  expansion, and pin state remain native-owned.
- `src/native-remote-sidebar.mjs` and `src/native-remote-sidebar-render.mjs` —
  bounded remote-device/project/conversation rendering and owner-routed actions.
- `src/native-unified-sidebar.mjs` — unified view of owner-native sidebars;
  `sidebar-contract`, `sidebar-federation`, and signed `sidebar-http` transport
  separate source snapshots/actions from presentation. The native model/actions
  adapters read committed renderer state and verify mutations on the owner.
  No independent section membership store or native-node movement.
- `src/new-project-policy.mjs`, `src/new-project-service.mjs`, and
  `src/native-new-projects.mjs` — pure new-project eligibility, read-only native
  project/task adapter with private graduation persistence, and an additive
  native-style sidebar view that preserves original membership.
- `src/native-attention-sticky.mjs` — scoped sticky positioning for the four
  native attention-layer headings without changing section ownership.
- `src/native-thread-read-state.mjs` — read-only access to the native renderer's
  current identity and local-host unread projection for attention sections;
  native read-state ownership and acknowledgements remain unchanged.
- `src/native-open-local-project.mjs` — bounded native-sidebar affordance that
  delegates local directory selection to the desktop's existing project flow.
- `src/native-writer-locator.mjs`, `src/windows-writer-inspection.mjs` —
  fail-closed active-writer routing with macOS process inspection and Windows
  Restart Manager ownership discovery behind one normalized contract.
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

## Native terminal transport on macOS

The native terminal adapter uses a fixed Runtime binding checked against the
top-level app context. It delegates metadata to TerminalConversationService and
PTY streaming to TerminalService. The packaged xterm view and shared session
controller render inside the native workspace without network frames or host CSP
changes. Browser HTTP and WebSocket adapters keep their exact-origin checks.
See ADR 0029 and the native terminal transport specification.
