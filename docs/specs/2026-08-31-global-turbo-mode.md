# Global Turbo mode

## Status

Implemented and verified on 2026-08-31.

## Problem

Before a known usage reset, the operator wants every Codex conversation on all
managed devices to use the most capable reasoning setting and Fast processing.
Changing hundreds of stored threads eagerly would be slow, acquire unnecessary
writer locks, overwrite per-thread preferences, and make disabling the mode
unsafe.

## User contract

- Turbo is one global switch placed in the native left-sidebar header beside
  Search and Activity, mirrored in the control-console header, and exposed by
  one bounded HTTP API.
- A settings control beside the native Turbo switch opens a compact popover.
  It configures model strategy, reasoning strategy, Fast, million context,
  access mode, and target devices. Settings are persisted with the Turbo policy
  and synchronized to every managed node.
- Defaults preserve the existing product behavior: keep each conversation's
  model, use the selected model's maximum supported reasoning effort, request
  Fast, keep the conversation's access mode, leave million context off, and
  target every device.
- Enabling it affects turns started through either the native ChatGPT desktop or
  the unified remote console on every connected node.
- Each new turn uses the highest reasoning effort supported by its selected
  model and the `priority` service tier (shown as Fast).
- A turn already running is not interrupted or restarted. Its next new turn is
  governed by the current Turbo state.
- Disabling Turbo restores normal behavior. Each conversation keeps the model,
  reasoning effort, service tier, access mode, and context preference it had
  outside Turbo.
- Turns that already started under Turbo continue unchanged.
- While Turbo is enabled, the native composer reasoning control shows the
  effective model maximum, Fast, and 1M when configured in the Turbo accent.
  The underlying native choices remain editable and reappear unchanged when
  Turbo is disabled.
- If Turbo's million-context option is enabled, the native bridge applies a
  one-million-token `thread/resume` configuration immediately before the next
  turn for that thread. It records only the bounded thread ids temporarily
  affected by Turbo. When Turbo or the option is disabled, the next turn for
  each affected thread first restores that thread's ordinary explicit context
  override, or the model default when none exists.

## API

Browser API, exact dashboard Origin required for mutation:

- `GET /api/turbo` returns the bounded Turbo policy and node results.
- `PUT /api/turbo` accepts one or more of `enabled`, `model`,
  `reasoningEffort`, `fast`, `millionContext`, `accessMode`, and `deviceIds`,
  and returns the converged node results. `model: null` preserves each thread's
  model; reasoning accepts `preserve`, `maximum`, or an effort supported by the
  fixed model; access accepts `preserve`, `read-only`, `workspace`, or
  `full-access`; an empty device list means every managed node.
  Partial node failure is reported rather than hidden.

Owner-node API:

- `POST /api/node/actions/turbo` uses the existing signed node-action headers,
  nonce replay protection, timestamp bound, body limit, and loopback SSH
  transport.
- The body accepts the same policy fields plus `requestId`, and requires at
  least one policy field.

No API returns model catalogs, filesystem paths, process ids, credentials, or
native protocol payloads.

## Turn enforcement

The native renderer bridge wraps only its fixed App Server transport function.
For an outgoing `turn/start` request while Turbo is enabled it:

1. clones the request and never mutates the native UI's object;
2. resolves the selected model from the turn request or collaboration settings;
3. optionally replaces the model, and applies the configured reasoning policy;
4. sets `serviceTierForTurn` to `priority` only when Fast is configured;
5. applies a named permission profile only when access is configured;
6. sends the modified `turn/start` through the same native App Server writer.

These are turn-scoped overrides. The bridge never writes thread settings, so
disabling Turbo restores the next turn to the native UI's unchanged model,
effort, and service-tier choices without a restoration request or writer lock.

Collaboration mode settings receive the same resolved model and effort inside
their existing settings object because those settings take precedence over the
top-level effort. Turbo does not change collaboration mode, permissions,
working directory, sandbox, personality, tools, or prompt. Context changes are
made only when the explicit Turbo million-context option is enabled.

If the selected model is absent from the current catalog, the bridge leaves its
effort unchanged and still requests Fast. It never invents an unsupported
effort. The node status reports the bounded catalog coverage.

## State and propagation

Each node persists only its local policy snapshot under its private wrapper
state directory. The snapshot contains the switch, bounded strategy fields,
target node ids, update time, and bounded model-to-effort catalog. It contains
no prompts or conversation content.

The coordinating node applies its local policy and fans the same switch to all
configured peers using direct SSH first and relay fallback. Nodes remain
independently enforceable through their signed owner endpoint. A disconnected
node is reported as pending/error and does not make a false global-success
claim; when its state is next explicitly synchronized, it converges.

Both the dedicated wrapper renderer and the primary native renderer receive the
same policy snapshot on injection and on every reconnect. Normal service startup
does not restart either desktop.

## Safety and rollback

- Loopback listeners, exact-Origin browser mutation checks, signed owner
  actions, strict SSH host verification, and response bounds remain invariants.
- Turbo never edits session rollouts, writer locks, application profiles, or
  native configuration files.
- Enabling or disabling does not send a user message or start a turn.
- Rollback disables Turbo on each reachable node and removes the enforcement
  injection on the next renderer refresh. Per-thread preferences need no bulk
  reconstruction.

## Acceptance criteria

- [x] The API rejects malformed bodies, non-exact origins, replayed owner
  actions, and unsupported methods.
- [x] Enabling persists across control-service restart and reaches both native
  renderer profiles.
- [x] A `turn/start` for every catalog model uses its highest supported effort
  and `serviceTierForTurn: priority`.
- [x] Collaboration mode receives the highest effort without changing its mode
  or developer instructions.
- [x] The original request object remains unchanged.
- [x] Turbo sends no sticky settings update and preserves each thread's native
  non-Turbo effort.
- [x] Disabling stops all overrides and retains the original settings.
- [x] An already active turn is not interrupted; the next turn observes the
  latest Turbo switch.
- [x] Turbo settings are editable beside the native switch and synchronize the
  million-context preference across nodes.
- [x] Turbo applies 1M before the next turn and restores the thread's ordinary
  context preference after the option or Turbo is disabled.
- [x] The strategy panel configures model, reasoning, Fast, access, and target
  devices without changing its safe defaults.
- [x] A node outside the selected device range receives the synchronized policy
  but does not enforce it locally.
- [x] Global responses expose partial peer failures truthfully.
- [x] Full tests, structure checks, and diff checks pass.

## Official protocol basis

The Codex App Server protocol defines `turn/start` as the boundary that begins a
new turn and accepts per-turn overrides including `effort`. The installed schema
also exposes `serviceTierForTurn` specifically without changing the thread's
stored tier. Model discovery advertises `supportedReasoningEfforts`, allowing the
client to select a supported maximum instead of assuming one universal value.
