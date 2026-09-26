# Retire the Turbo device-scope controls

## Request

The separate Save and Sync to all devices buttons now express where a settings
change is delivered. Remove the redundant Apply to all devices switch and the
device selection list from the Turbo settings panel.

## Behavior

- The settings panel shows neither the application-scope switch nor device
  checkboxes or their scope-specific explanatory/validation text.
- Save persists settings on this node only. Sync to all devices saves locally
  and distributes the current settings to every configured peer, retaining
  individual results and retry support.
- Both actions submit `deviceIds: []` (the existing unrestricted policy value).
  Previously selected device IDs must not remain as an invisible restriction
  after either settings action. Opening the panel alone does not write settings.
- Retain the internal policy/transport field with its canonical empty value.
  The policy store clears legacy selected-device lists on initialization and
  all writes, so header-only toggles and incoming old peer settings cannot leave
  a hidden restriction. Effective local activation depends on enabled state.
  Preserve other stored preferences and per-node identity. Existing validation
  still rejects malformed device lists; well-formed old lists are retired.
- Preserve pending-action protection, unsaved form values, quota controls and
  per-node quota-trigger behavior.
- Bump the native injection version so existing windows receive the new panel.

## Verification

- Rendered DOM fixture has no scope controls or obsolete text.
- Save and direct Sync both clear previous selected-device restrictions in their
  outgoing payloads; their distinct operations remain intact.
- Verify persisted legacy scope migration, enabled-only toggles, and writes of
  old peer scope values all result in unrestricted local activation.
- Retain coverage for busy state, errors, retry, dirty form and quota controls.
- Run repository checks and full tests. Deploy only the changed runtime
  source files with verified baselines, backups and hash readback on each node.
- Record native visual verification limitations separately from source and DOM
  fixture validation.

## Delivery evidence (2026-09-26)

- `npm run check` passed: 577 syntax-checked files and 613 structure-checked
  files. `npm test` passed all 1084 tests, including scope migration, both form
  operations, pending/error states, and the existing quota behavior.
- Independent review found no outstanding code issues.
- Local companion reload succeeded; `/api/turbo` returned 200 with all ten
  policy fields unchanged, empty `deviceIds`, and `active === enabled`.
- MacBook Pro received the four runtime files after exact baseline verification,
  source backup and syntax checks. All deployed hashes match, the source guard
  is `2026-09-26.device-scope-retired1`, and the companion-only restart recovered
  with all ten policy fields unchanged. Backup:
  `/Users/dev/.codex-control-console/runtime-backups/turbo-retire-scope-20260926T121518-f3eddfd1`.
- Windows Desktop received the same four files after exact baseline verification,
  source backup, patch and syntax checks. All final hashes and the version guard
  match; the verified companion process restarted and its scheduled task is
  running. All ten preference fields remain unchanged, with `deviceIds: []`,
  `active === enabled`, and quota protection enabled at 10%. Backup:
  `C:\Users\Admin\.codex-control-console\deploy-backups\turbo-retire-scope-20260926-121522-d0777bd4`.
- Native window visual acceptance remains unverified because Computer Use
  previously denied access to the Codex application. DOM fixture checks and
  runtime source verification are not a native rendered-window inspection.
