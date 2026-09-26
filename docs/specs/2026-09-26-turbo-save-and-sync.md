# Separate Turbo save and device synchronization

## Problem and observed evidence

The native settings panel labels one action `保存并同步`, closes immediately,
and drops the coordinator result. The coordinator sends only the changed fields
to peers. A later enabled-only toggle therefore preserves previously divergent
settings on each device even when transport reports `applied`.

The local coordinator's last-result snapshot on 2026-09-26 shows all three nodes applied, but
the MacBook Pro differs in reasoning, Fast, context and routing interlock; the
Windows node differs in context and routing interlock. Both have device scopes
different from the local empty (all devices) scope.

## Behavior

- `保存` persists the current form only on this device, applies its local routing
  interlock, keeps the panel open and shows a local-save confirmation.
- `同步到所有设备` first saves the current form locally, then sends the complete
  resulting policy, including enabled state and access mode, to every configured
  trusted peer. Existing per-device differences must converge after a successful
  synchronization. No credentials, identities or unrelated settings are copied.
- Device selection is labelled as the policy's application scope, separately from
  delivery. Synchronization reaches every configured peer even if a peer is not
  in that application scope; it does not silently widen the selected scope.
- Existing global enable/disable controls keep their all-device behavior and send
  a complete resulting policy as well.
- Settings actions carry an explicit save/sync operation and request identity;
  results return to the requesting native renderer. Periodic policy refresh must
  not clear a pending action. Disable duplicate submissions while it is pending.
  A 90-second missing-result timeout reports unknown completion and permits retry;
  stale replies cannot replace a later request's result.
- The panel stays open to display per-device applied, mismatch, or failed results.
  Local save failures and routing-interlock failures remain visible. An offline
  or failed peer does not undo local save or count as success; the user can retry
  synchronization. This is explicit one-shot synchronization, not an offline queue.
- Policy snapshots and existing signed owner actions remain policy-only. Browser
  save and sync actions use bounded exact-origin routes. Owner writes continue
  through existing authenticated transports and do not fan out recursively.
- Outgoing save/sync actions are serialized within a coordinator. Incoming signed
  owner writes use the same local mutation path and reject with a visible busy
  conflict while another operation is pending, avoiding mutual-sync deadlocks
  and success reports for overwritten local policies.

## Verification

- Coordinator regression tests: local-only save, full-policy convergence from
  different initial policies, all registered peers regardless of apply scope,
  per-peer failure/mismatch, and no remote mutation if local persistence fails.
- Native binding and UI tests: strict operation/request validation, isolated save
  versus sync actions, round-trip result delivery, pending and visible feedback.
- HTTP tests retain exact-origin and signed owner protections and exercise new
  save/sync routes without admitting operation metadata into persisted policy.
- Run `npm run check` and `npm test`; restart only the companion service, inspect
  the actual rendered panel, exercise save, and verify synchronized policies by
  independent owner readback where devices are reachable.

## Delivery evidence (2026-09-26)

- Root cause confirmed by the SSH adapter regression: the former field allowlist
  rejected `autoDisableGlobalRouting` before transport, and its acknowledgement
  projection omitted that field. Both now use a complete bounded policy contract.
- `npm run check`: passed (552 syntax-checked files; 586 structure-checked files).
  `npm test`: 992 passed, including simultaneous two-device synchronization,
  incoming owner conflicts, strict authentication, action feedback and UI form
  preservation.
- Restarted only the local companion service to load the change. The live save
  endpoint returned 200 with only `mac-air`; independent reads confirmed both
  remote policies and update timestamps were unchanged.
- The live sync endpoint returned 200, `converged: true`, and applied results for
  DevBook Air, MacBook Pro and Windows Desktop. Independent SSH reads of each
  remote owner's `/api/turbo` matched all eight local policy fields.
- Verified common policy: enabled, `gpt-6-astra`, maximum reasoning, Fast disabled,
  million context enabled, automatic global-routing interlock enabled, preserved
  access mode, and all-device application scope. No preference values were changed
  for the live verification.
- Native visual acceptance remains unverified: Computer Use refused access to
  the Codex application for safety reasons. The generated UI and action behavior
  passed tests, but those tests and service attachment are not a rendered-window
  acceptance result. No remote application code rollout was performed.
