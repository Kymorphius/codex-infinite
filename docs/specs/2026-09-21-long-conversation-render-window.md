# Long conversation render window

## Problem

The native ChatGPT/Codex conversation surface keeps old turns mounted. In long
threads, Chromium can spend substantial layout and paint time on content the
user is not currently reading. Existing enhanced-client observers avoid idle
self-trigger loops, but they do not reduce the native timeline's rendering
cost.

## User outcome

- The newest 12 rendered turns stay eager and behave exactly as before.
- Older turns remain in the native DOM and retain navigation, search, copy,
  annotations, Jev receipts, and scroll-to-turn behavior.
- Chromium may skip layout and paint for older turns while they are far outside
  the viewport, and restores them automatically when they approach it.
- The optimization performs no network request, conversation deletion,
  history truncation, or model-context change.

## Design

Install one native-page controller through both injection paths. It marks all
but the newest 12 `[data-turn-key]` nodes as cold and applies
`content-visibility: auto` with an intrinsic block-size estimate. The browser,
not the controller, decides when a cold turn must be rendered.

The controller observes only timeline-root or turn mount changes. Unrelated
native activity and mutations produced by enhanced controls do not schedule a
full turn scan. Reconciliation runs through `requestIdleCallback` when
available, with a bounded timer fallback.

The controller exposes a read-only snapshot for live verification and supports
idempotent reinstall and cleanup across version upgrades.

## Acceptance

- A 20-turn conversation marks the oldest 8 turns cold and keeps the newest 12
  eager.
- A conversation with 12 or fewer turns marks none cold.
- Appending a turn moves the eager boundary without removing any turn.
- Unrelated DOM mutations do not schedule reconciliation.
- Both primary injection paths install the controller.
- `npm run check` and `npm test` pass.
