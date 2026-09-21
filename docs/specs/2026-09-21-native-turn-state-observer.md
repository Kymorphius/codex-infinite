# Native turn-state observation

## Goal

Show privacy-safe `x-codex-turn-state` observations inside the currently open
native Codex conversation. The display is diagnostic evidence, not a claim
about model quality or entitlement.

## Contract

- Read only the local Codex Router's capability-protected `/activity` endpoint.
- Keep the caller capability on the Node side. It must never enter injected
  page state, DOM attributes, logs, errors, or browser storage.
- Accept only bounded records with valid conversation and optional turn ids. Retain model,
  HTTP status, upstream attempt count, timestamps, and `{present, length}`.
- Never read, store, hash, display, or replay the opaque turn-state value.
- Cache the Router snapshot briefly so enhanced and owner-native injectors do
  not create duplicate high-frequency reads.
- Filter observations by the mounted native conversation id before rendering.
- Present 292, 312, 332, other lengths, and missing state neutrally. The UI
  explicitly says that length alone does not establish model quality.
- Router unavailability degrades to an unavailable badge and never blocks the
  conversation or any existing injected control.

## Native UI

- Add a compact header badge beside the existing Jev and Turbo controls.
- Add a compact badge beside each visible user turn when Router activity has
  an exact matching native turn id. Never infer a match from timestamps.
- Label the latest current-conversation observation as `State N`, `State —`,
  or `State ?` when the observer is unavailable.
- Clicking the badge opens a bounded popover with per-length counts and recent
  records for the current conversation only.
- Switching conversations immediately re-filters the already supplied
  snapshot; no page reload is required.
- Clicking a per-turn badge opens the same privacy-safe details, scoped only
  to that exact turn.

## Acceptance

1. A real current conversation with a 292 observation renders `State 292`.
2. A visible turn with an exact Router `turnId` match renders its own badge;
   an unmatched turn renders no badge.
3. The popover reports counts and recent metadata without the opaque value.
4. Another conversation's observations never appear in the current one.
5. Missing or unreachable Router state does not affect message sending.
6. Targeted tests, `npm run check`, and `npm test` are run before delivery.
