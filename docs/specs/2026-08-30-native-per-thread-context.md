# Native per-thread context selection

## Status

Implemented and verified on 2026-08-30.

## Problem

The wrapper currently writes `model_context_window = 1000000` and
`model_auto_compact_token_limit = 1000000` into its root `config.toml`. That
makes every native conversation request the extended window. Most conversations
do not need it, and a global setting makes the exceptional, higher-cost mode the
default.

The existing context-override store is already keyed by native thread UUID, but
only the background board dispatcher consumes it. Opening the same thread in the
native desktop interface does not apply the saved override.

## Goals

- Keep ordinary wrapper conversations on the selected model's default context.
- Put an immediate, clearly labeled million-context switch in the current native
  conversation composer so users never need to locate or copy a thread ID.
- Apply a saved context override to the matching native thread when it is opened
  through the control console or the native sidebar.
- Send the override through the desktop app's own app-server connection so the
  conversation remains visible and interactive in the native interface.
- Keep the existing board-dispatch behavior and persistence format compatible.
- Show users that the setting is per conversation, not global.

## Non-goals

- Changing model entitlements or promising that a model will accept more than
  its advertised maximum.
- Sending a test turn to a user's conversation merely to observe token usage.
- Supporting remote-node native mutation in this slice.
- Sharing Chromium profiles or removing the wrapper's isolated `CODEX_HOME`.

## User behavior

1. A conversation without a saved override uses model defaults.
2. When a saved native conversation is selected, its composer shows a
   `百万上下文` switch with an explicit on/off state. Enabling or disabling it
   immediately resumes the current thread with the selected mode and persists
   the choice in the background.
3. Saving an override from the management page remains available for bulk
   inspection, but is not required for normal use.
4. Opening an enabled thread from the session center resumes it with
   `model_context_window` and `model_auto_compact_token_limit` in the native
   `thread/resume` request before navigation.
5. Clicking the same configured thread in the native sidebar reapplies the
   override after the native navigation settles.
6. Turning the switch off resumes the idle thread with empty thread-level
   overrides so model defaults apply. A running turn is never mutated mid-turn;
   a failed change is visibly rolled back.

## Contracts and architecture

- `ContextWindowStore` remains the source of truth and retains its version-1
  JSON format.
- `CodexInjector` transfers a normalized read-only snapshot of overrides into
  the renderer over the existing loopback CDP connection. The native page does
  not fetch the dashboard API cross-origin.
- Renderer switch actions enter a bounded in-memory queue. `CodexInjector`
  drains validated set/remove actions and writes them through
  `ContextWindowStore`; this preserves the dashboard's exact-origin HTTP safety
  boundary instead of opening a cross-origin mutation route.
- A focused native-context injection module owns app-server request correlation,
  resume parameters, sidebar selection detection, and override synchronization.
- The general workspace injection calls the native-context bridge when it opens
  a UUID-backed local task; it does not know app-server message details.
- `src/main.mjs` remains the composition root and provides the store to the
  injector.
- Wrapper config preparation removes root context/compaction overrides inherited
  from the source configuration instead of adding a global override.

## Safety

- Networking remains loopback-only and the existing exact-origin mutation checks
  are unchanged.
- Only validated UUIDs and bounded integer window values enter the renderer.
- Only validated `set`/`remove` actions can leave the renderer; the queue is
  bounded and contains no prompts, credentials, paths, or conversation content.
- Native app-server requests use the wrapper's existing desktop connection; no
  second writer process is started.
- No conversation message is created during activation or verification.
- Credentials and complete configuration files never enter the renderer.

## Verification

- Unit-test root config removal, override payload normalization, native bridge
  source, composer switch/action queue, asynchronous native opening, action
  persistence, and injector snapshot refresh.
- Run `npm run check` and `npm test`.
- Restart only the wrapper service/application, then verify its generated
  `config.toml` has no global context keys.
- In the live wrapper, verify a configured thread emits a native
  `thread/resume` request with both per-thread keys and remains openable in the
  native interface. Actual `modelContextWindow` is observed on the next real
  turn's native token-usage event; verification must not create a synthetic user
  message.

## Rollback

Remove the native-context bridge and injector snapshot wiring, then restore the
previous wrapper config generation. The saved override file remains compatible
with the board dispatcher and requires no migration.
