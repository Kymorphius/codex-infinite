# Turbo panel switches and routing interlock

## User-visible behavior

- Replace the three ambiguous native checkboxes in the Turbo context-menu panel
  with visible sliding switches. The whole row and the switch remain clickable,
  show their current state immediately, and retain keyboard checkbox semantics.
- Add `自动关闭全局路由`. When selected, saving while Turbo is already enabled,
  or subsequently enabling Turbo, disables the Jev global routing default.
- Disabling Turbo does not restore global routing. The user can re-enable routing
  explicitly; automatic restoration would overwrite a later user decision.
- The setting is persisted with the Turbo policy and synchronized to selected
  devices. On each receiving node, an enabled Turbo policy with this setting
  disables that node's Jev global route. Per-conversation routing overrides are
  cleared by the existing global-disable contract.

## Boundaries

- UI changes are submitted only through the existing bounded Turbo binding.
- The policy field is a boolean named `autoDisableGlobalRouting`; missing values
  default to `false` for backward compatibility.
- Turbo remains enabled if routing shutdown fails, but the failure is surfaced by
  the existing action chain instead of falsely reporting a completed interlock.
- No routing mode, model mapping, Turbo model, or device identity is changed by
  this feature beyond the explicit global routing disable action.

## Verification

- Contract and persistence tests cover default, update, restore, HTTP owner and
  browser boundaries, and unknown/type-invalid values.
- Coordinator tests cover enable-time, save-while-enabled, disabled policy, and
  no automatic route restoration.
- Native injection tests cover the fourth switch, visible thumb state, full-row
  pointer behavior, and submitted action shape.
- Use CDP mouse input and hit testing in the live native window because synthetic
  `.click()` alone cannot detect drag-region or pointer interception.

## Acceptance evidence (2026-09-22)

- `npm run check`: 463 syntax checks and 495 structure checks passed.
- `npm test`: 768 tests passed with zero failures or skips.
- Restarted only the companion service and read back injection version
  `2026-09-22.panel-switches1`; the Codex desktop process stayed open.
- In the live native panel, CDP mouse input hit the transparent checkbox input
  itself for all four rows. Every switch moved `translateX(0px) ↔ 14px`; each was
  clicked twice and returned to its original value. The panel was closed without
  submitting, and `/api/turbo` readback confirmed the saved policy was unchanged.
- The live Jev global route was already disabled before acceptance. Automatic
  shutdown was therefore verified through application, browser/owner HTTP, and
  multi-node policy tests rather than by mutating the user's routing configuration.
