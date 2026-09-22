# Turbo per-turn settings badges

## Intent

Show a compact Turbo badge beneath each newly observed Turbo user turn, beside
the existing Jev/State metadata. Include model, reasoning effort and confirmed
Fast / million-context settings. Do not infer historical Turbo use from today's
policy or from message text, order, or timestamps.

## Contract and provenance

- Key records by exact local `(threadId, turnId)` UUIDs. Retain at most 512
  allowlisted metadata records in the current desktop profile's localStorage;
  never retain prompts, response content, permissions or credentials.
- Writable bridge: snapshot the transformed `turn/start` parameters at dispatch;
  bind them to the matching successful `mcp-response` request ID and turn ID.
  Context preparation and send failures must not create receipts.
- Frozen production bridge: observe local `turn/started` notifications (flat
  native envelope and legacy nested envelope), snapshot only that thread's
  successfully verified Turbo native-settings lease for the current policy.
  Conflicting `thread/settings/updated` metadata invalidates that snapshot for
  annotation until enforcement verifies a fresh one or a complete native settings
  notification confirms the matching model/effort/tier. Annotation does not force
  settings to be reapplied. Missing evidence means no
  badge. Never read the currently selected thread to assign an event's identity.
- The badge is **Turbo sending/native settings**, not an upstream model receipt.
  The tooltip states this boundary explicitly; Jev continues to show its separate
  upstream routing result. No confidence/tier is invented for Turbo.
- Existing records are immutable after a turn is accepted. Switching or disabling
  Turbo cannot rewrite previous badges. LocalStorage events merge profile-local
  windows without stealing another window's records.

## Rendering and lifecycle

- Gold, compact pill in the same position/style family as Jev. Example:
  `Turbo · GPT-6 Astra · Ultra · Fast · 百万`.
- Render only exact visible thread/turn matches. Update on records and relevant
  native turn/composer mounts, not scroll or streamed text. Unchanged badges keep
  node identity and do not write DOM attributes/styles repeatedly.
- Use shared native mount notifications when available, with a bounded fallback
  observer for standalone native-owner injection. Observe only turn/composer ID
  attributes for reused nodes; no layout/style attribute subscription.
- Reinjecting cleans up its listeners/subscriber/pending map; records survive.
  This feature adds no polling timer, network request, or change to send settings.

## Verification

Test request/response correlation, frozen bridge notifications, settings conflicts,
policy changes in flight, disabled/off-device/remote/invalid traffic, failure,
bounded storage, deduplication, remount and unchanged-render identity. Run the
repository check and full test suites. Inspect the rendered badge in a clearly
isolated live-desktop preview; do not fabricate a receipt for an existing turn.
Hot-load the new injection into the current native window when safely available.
Live upstream dispatch is a separate acceptance boundary from a preview.

## Acceptance evidence (2026-09-22)

- `npm run check`: 462 syntax checks and 494 structure checks passed.
- `npm test`: 765 passed, zero failures or skips, including frozen/writable bridge
  capture, policy updates during verification, current context overrides,
  passive invalidation recovery, standalone mounts and render idempotence.
- An isolated, explicitly labelled test-data preview in the live desktop showed
  `Turbo · GPT-6 Astra · Ultra · Fast · 百万`; 100 unchanged renders retained the
  same node with zero DOM mutations. Preview removed afterward; no fake receipt
  was added to any native conversation or persistent history.
- Restarted only the local companion service (not the desktop app); read back
  `2026-09-22.turn-receipts1` and active verified Turbo enforcement on the same
  native CDP target. No test message was submitted. Genuine native turn-event
  acceptance remains observable on the next real Turbo message; no old turns
  are backfilled during this deployment.
