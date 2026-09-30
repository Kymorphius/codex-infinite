# Native model catalog source after the ChatGPT update

## Observed failure

Backend startup snapshots Turbo options from the source CLI home model cache.
During the sidebar reload verification, that shared cache alternated between a
seven-visible-model list without GPT-6.1 Sol and the current native list with it.
Two backend reloads reproduced the stale seven-model snapshot. The dedicated
native home cache already contained GPT-6.1 Sol with all six supported efforts.

The enhanced native app uses `nativeCodexHome`; its cache represents the app this
console is configuring. The shared CLI cache can be refreshed by other clients.
The current behavior therefore does not consistently reflect the affected native
app's current catalog even though model normalization supports GPT-6.1 Sol.

## Required behavior

- Preserve an explicit `CODEX_CONTROL_MODEL_CATALOG_PATH` override exactly.
- Prefer the model cache in the configured native app home when it exists.
- If that cache is absent, retain the source CLI home cache as the startup
  fallback. On Windows these homes already coincide.
- Do not copy, merge, or edit native model caches or fabricate model availability.
- Preserve model selections, Turbo enablement, reasoning effort, credentials,
  profiles, and all unrelated machine configuration.

## Scope and verification

This is a startup adapter/configuration correction. Keep filesystem existence
checks behind a focused resolver so platform paths and override/fallback behavior
can be tested independently. No change to model metadata normalization, HTTP
contracts, networking, or native UI access is required.

Regression evidence must cover dedicated-versus-shared caches, missing dedicated
cache, explicit override, same-home Windows paths, and POSIX/Windows path syntax.
Run `npm run check` and `npm test`; commit owned changes. Reload at zero running
terminals under the user's current reload authorization and confirm GPT-6.1 Sol
through the backend catalog without claiming native-window visual acceptance.

## Verified delivery

- Fresh read-only review found no required corrections. Empty explicit-path
  values retain the previous fallback behavior; nonempty paths stay unchanged.
- `npm run check` passed: 837 syntax files, 69 module-graph modules, and 879
  structure files. `npm test` passed: 1811/1811.
- The resolver selects the dedicated native home cache on the affected macOS
  installation. After a backend-only reload at zero running terminals,
  `/api/health` is OK, the runtime has a new instance, and `/api/turbo` reports
  eight visible options including `gpt-6.1-sol` with low, medium, high, xhigh,
  max, and ultra. Turbo remains disabled and its selected model/reasoning policy
  remain unchanged.
- Original and enhanced native app processes remain running. Final native
  sidebar appearance and model-picker click acceptance are still unobserved
  because native UI access is denied.
