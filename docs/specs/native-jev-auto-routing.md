# Native Jev auto-routing

## Outcome

The native Codex composer exposes a Jev auto-routing switch. It is enabled by
default. While enabled, every new native `turn/start` request—including turns
sent in an existing conversation—is classified before dispatch. The selected
model and reasoning effort are applied to that turn.

Previously completed turns are not rewritten. Disabling the switch restores
the native request unchanged on subsequent turns.

## Shared configuration

The existing shared `jev-task-routing.json` remains the single authority for
the eight tier mappings, confidence threshold, fallback tier, and the new
`enabled` flag. Schema version 3 adds `enabled`, defaulting to `true`; version 1
and version 2 files migrate without losing their mappings.

The Router control center, enhanced console, dedicated Codex window, and
primary native Codex window all read the same file.

## Native dispatch flow

1. The renderer intercepts a local native `turn/start` request through the
   existing owned bridge wrapper.
2. When auto-routing is enabled, it extracts bounded text from the turn input
   and requests a classification through a CDP runtime binding.
3. The Node-side Jev routing service reads the latest shared configuration and
   returns a bounded classification result.
4. The renderer clones the request and applies the selected model and effort.
   Collaboration-mode settings are updated inside their existing settings
   object; ordinary turns use top-level `model` and `effort`.
5. Turbo may still control context size, speed, and permissions, but Jev owns
   model and reasoning effort while auto-routing is enabled.

An attachment-only or otherwise text-free turn uses the configured fallback
tier without invoking Jev. If the binding is unavailable or times out, the
turn is sent unchanged rather than being lost. Jev's own unavailable,
malformed, timeout, and low-confidence paths continue to use the configured
fallback tier.

## Native control

A compact `Jev 自动` switch is mounted in the native header beside the existing
Turbo controls. It is present in both the dedicated enhanced window and the
primary native window when the primary bridge is enabled. Its state is saved
through the same CDP binding and is refreshed from the shared store. After a
routed turn, the control reports the selected tier, model, and effort in its
accessible label and tooltip.

## Compatibility and boundaries

- Native request objects are cloned; the application's original objects are
  not mutated.
- Non-local messages and methods other than `turn/start` are untouched.
- The feature does not intercept CLI-only, scheduled, remote-node, or external
  client turns that do not pass through the native renderer bridge.
- Routing configuration mutations remain local and private (`0600`).
- The runtime binding accepts only bounded, typed classify and toggle actions.

## Acceptance

- The shared schema migrates to version 3 with `enabled: true` by default.
- Saving either control surface preserves the enabled state.
- The native switch is visibly present and initially on.
- A new conversation and an existing conversation both apply the Jev-selected
  model and effort on their next turn.
- Disabling the switch leaves the next native turn's model and effort intact.
- Turbo context, speed, and permission behavior remains operational, while Jev
  takes precedence for model and reasoning effort.
- Focused tests, the full repository tests, static checks, and visible native
  UI verification pass without issuing a quota-consuming real Jev task.
