# Native Jev auto-routing

## Outcome

The native Codex composer exposes a Jev auto-routing switch. It is enabled by
default. While enabled, every native composer submission—including turns sent
in an existing conversation—is classified before dispatch. The selected model
and reasoning effort are applied to that turn.

Previously completed turns are not rewritten. Disabling the switch restores
the native request unchanged on subsequent turns.

## Shared configuration

The existing shared `jev-task-routing.json` remains the single authority for
the eight tier mappings, low-confidence marker, failure fallback tier, global `enabled`
flag, and transport mode. Schema version 4 adds `transportMode`, defaulting to
`router`; version 1 through version 3 files migrate without losing their
mappings.

The Router control center, enhanced console, dedicated Codex window, and
primary native Codex window all read the same file.

## Native dispatch flow

1. The renderer captures the native composer send action before Codex submits
   it. This works with the current frozen Electron bridge; writable legacy
   bridges retain the bounded `turn/start` wrapper as a compatibility path.
2. When auto-routing is enabled, it extracts bounded text from the composer
   and requests a classification through a CDP runtime binding.
3. The Node-side Jev routing service reads the latest shared configuration and
   returns a bounded classification result.
4. In `native` transport mode, the renderer applies the selected model and
   effort through the native `thread/settings/update` path, waits up to five
   seconds for the native send control to recover from any settings rerender,
   then releases the original send action exactly once. On a
   writable compatibility bridge it clones the request and updates the
   corresponding ordinary or collaboration-mode fields.
5. In `router` transport mode, the enhanced runtime keeps its root
   `openai_base_url` on the local Router. Router discovery is enabled so the
   current Codex ChatGPT bearer can be verified instead of being rejected with
   a caller-capability 401. Changing that authentication state restarts only
   the Router service; changing the enhanced runtime endpoint is reported as
   requiring a runtime restart.
6. Turbo may still control context size, speed, and permissions, but Jev owns
   model and reasoning effort while auto-routing is enabled.

An attachment-only or otherwise text-free turn uses the configured fallback
tier without invoking Jev. If the binding or native settings path is
unavailable or times out, the original send action is released unchanged
rather than being lost. The configured fallback tier is used only when Jev is
unavailable, times out, fails, or returns an invalid result. A valid
low-confidence choice is applied and visibly marked instead of being replaced
by the fallback tier.

## Native control

A compact `Jev 全局` switch is mounted in the native header beside the existing
Turbo controls. It changes the default for every conversation and clears prior
per-conversation overrides so it acts as a true unified switch. A second
`Jev 原生` or `Jev 路由` switch is mounted in the composer footer beside the
permission and million-context controls; it changes only the currently visible conversation.
Conversations without an override inherit the global state. Both controls are
present in the dedicated enhanced window and the primary native window when the
primary bridge is enabled. Their state is saved through the same CDP binding.
After a routed turn, the bounded result is attached to that turn's user-message footer as a compact badge, for example
`Jev · 复杂 · GPT-5.6 Sol · medium`. Turn badges are retained locally with a
bounded history and never added to the model prompt.

When Router interception makes Codex's native model-change notice collapse both
the old and new model names to `自定义`, the enhanced renderer rewrites only the
new Jev-generated notice to show the concrete selected model, reasoning effort,
confidence, and low-confidence or fallback state. Unrelated native notices and
conversation text remain untouched.

The shared configuration panel exposes two explicit transport choices:

- `Jev 原生` removes the enhanced runtime's Router endpoint. Jev
  still selects the native model and effort before releasing the send action.
- `Jev 路由` keeps every enhanced-runtime request on the local Router and
  enables authenticated native-session discovery for existing conversations.

## Compatibility and boundaries

- The original composer action is delayed only while classification and native
  settings are applied; it is then released once. Compatibility request
  objects are cloned rather than mutated.
- Non-local messages and methods other than `turn/start` are untouched.
- The feature does not intercept CLI-only, scheduled, remote-node, or external
  client turns that do not pass through the native renderer bridge.
- Routing configuration mutations remain local and private (`0600`).
- The runtime binding accepts only bounded, typed classify and toggle actions.

## Acceptance

- The shared schema migrates to version 4 with `enabled: true` and
  `transportMode: "router"` by default.
- Saving either transport choice preserves the mappings and clearly reports
  when the enhanced runtime must be restarted before the endpoint change is
  active.
- Saving either control surface preserves the enabled state.
- The global native switch and the current-conversation composer switch are
  visibly present and initially on.
- A new conversation and an existing conversation both apply the Jev-selected
  model and effort on their next turn.
- Each routed turn visibly shows its tier, model, and reasoning effort without
  changing the conversation content sent to the model.
- A valid low-confidence Jev choice keeps its selected tier and is marked as
  low confidence; only missing, failed, or invalid Jev results use the fallback.
- A Router-intercepted turn never leaves the Jev-generated native status line as
  `自定义 → 自定义`; it shows the selected model, reasoning effort, confidence,
  and whether the fallback mapping was used.
- Disabling the current-conversation switch leaves that conversation's next
  native turn model and effort intact without changing other conversations.
- Turbo context, speed, and permission behavior remains operational, while Jev
  takes precedence for model and reasoning effort.
- Focused tests, the full repository tests, static checks, and visible native
  UI verification pass without issuing a quota-consuming real Jev task.
