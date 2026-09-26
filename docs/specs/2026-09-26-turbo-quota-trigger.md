# Turbo remaining-quota shutdown

## Requested behavior

Add a configurable remaining-account-quota trigger that automatically disables
Turbo at or below a threshold, defaulting to 10 percent. This extends the separate
local-save and all-device-sync settings contract.

## Contract

- Policy fields: `autoDisableOnLowQuota` (boolean, default true) and
  `quotaRemainingThreshold` (integer 0..100, default 10). Missing stored fields get
  these defaults; malformed submitted fields are rejected before persistence.
- Compare remaining percentage (`100 - usedPercent`) for every valid core
  `codex` account window. A weekly window can be primary; do not infer duration
  from primary/secondary. Extra model buckets never trigger this account guard.
- Trigger when any available core window is at or below the configured threshold.
  Missing/invalid values, read failures, and already expired window samples are
  unknown and must not be treated as exhausted quota.
- Settings UI shows an enable switch and remaining-percent numeric input, labelled
  clearly as a remaining threshold. Both settings use existing save/sync actions.
- Each device reads its own native Codex profile's account. Automatic shutdown
  is local. Synchronizing settings shares the
  trigger configuration, never account quota or account identity.
- Triggering persists `enabled: false`, preserving all other settings and existing
  sessions. Never auto-enable after a quota reset. Status explains whether the
  trigger is monitoring, unavailable, disabled, or has switched Turbo off.
- A monitor checks immediately at runtime startup and every 60 seconds with one
  read in flight. It stops during service shutdown/restart and ignores an old read
  after stop. Only enabled, applicable Turbo policies with this trigger enabled
  need polling. Use the existing bounded App Server account-usage reader.
- Recheck policy and freshness at the serialized coordinator mutation boundary,
  so a stale read cannot override a newer user choice. Auto-off does not fan out
  through global toggles or copy unrelated policy fields to other machines.
- Keep browser exact-origin checks, signed owner authentication and concurrent
  owner-write protection. New fields are included in complete sync acknowledgements.

## Verification and delivery

- Pure threshold tests: 11/10/9 percent, either core window, unknown/malformed/
  expired/extra buckets, disabled trigger, and inclusive 0/100 boundaries.
- Policy save/reload and full-policy sync cover both fields; all HTTP/native/SSH
  boundaries validate types/range and preserve metadata separation.
- Monitor tests cover local-only disable, no re-enable, errors, single-flight,
  stop/in-flight cancellation and policy change during read.
- UI tests cover default10, enable/disable input behavior, validation, action payloads,
  existing form preservation and visible trigger status.
- Run `npm run check` and `npm test`. Read live quota and policy after loading the
  local runtime; test low-quota shutdown with controlled adapters without forcing
  a live user preference to an artificial threshold.
- Existing unrelated project-sync changes in main and other files must remain
  untouched and outside the Turbo commit. Record any runtime/deployment limitations.

## Verification evidence

- `npm run check` passed: 577 syntax-checked and 613 structure-checked files.
  The final `npm test` run passed all 1081 tests. Focused review additionally
  verified the shutdown path without model discovery and invalidation of old
  shutdown explanations after a settings edit.
- A controlled real-file persistence smoke check supplied a 90%-used core weekly
  window and observed `enabled: false` saved to an isolated policy file, with
  `quotaStatus.state: triggered` at the default remaining10 threshold. It made no
  remote calls and did not alter the live account's preferences or quota.
- Local service readback showed default trigger true, threshold10 and healthy
  monitoring at remaining50, preserving the enabled Turbo state.
- The concurrent project-sync change was committed separately as `49b2332`.
  Remote deployment detected its newer main-file baseline before writing, then
  regenerated only the Turbo patch against that verified baseline to preserve it.
- Installed runtime updates include the prior `441e356` save/sync dependencies,
  with per-file baseline/after hashes, source-only rollback backups and companion
  service restarts. Account profiles, node settings and credentials stay local.
- MacBook Pro and Windows each passed all 16 deployment source hashes and syntax
  checks. Both independently reported trigger true/threshold10 and healthy quota
  monitoring at remaining49; their account-usage APIs independently reported 51%
  used for the core weekly window. The installed artifacts were updated without
  staging or committing unrelated historical deployment differences there.
- Final live save returned only the local node and left both remote policies and
  update times unchanged. Full-policy sync returned 200/converged with all three
  nodes applied; independent remote reads matched all ten policy fields, including
  the new quota trigger and threshold. No artificial live threshold was used.
- Native visual acceptance remains blocked by the Computer Use restriction on
  accessing Codex itself. Tests and API readbacks do not substitute for inspection
  of the rendered native settings panel.
