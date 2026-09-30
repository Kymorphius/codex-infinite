# Dot position, grouped project search, and native model menu refresh

## Current user evidence

The user confirmed that the previously misplaced module entries are repaired.
Their new screenshot still shows project search between 看板 and 控制台, with
the native Alfred dot below all enhanced actions. They request dot at the current
管家 position and clarified that project search belongs at the end of the shortcut
action group, above the project list.

The user also confirmed the missing GPT-6.1 Sol is in the native composer model
menu. Its screenshot lists the old GPT models plus configured Claude entries.
The console's `/api/turbo` catalog is a separate data chain and is not evidence
that this native model picker has refreshed.

## Layout behavior

- Restore the native dot immediately after New chat in the same original parent;
  keep the existing 管家 action next, preserving its function.
- Identify dot by `[data-sidebar-destination="builtin:orbit"]`, scoped to the
  current text action group. Never match the user's nickname or clone the dot.
- Preserve native node identity, avatar/name, selected/paused/unread state,
  keyboard order, native click and context-menu handling.
- Only move a dot that already shares the native New-chat parent. Do not move
  nodes between native panes. Defer restoration during a temporary Butler-only
  fallback if it would fight that installer's New-chat anchoring; resume once
  normal top actions are ready.
- Keep enhanced module actions grouped after checklist. If checklist is not yet
  available, use the last ready native/top action rather than splitting New chat
  and dot. Ensure repeat installation causes no writes or observer reorder loop.
- Place project search after 项目优先级, or the last ready enhanced shortcut when
  installation is incomplete. Preserve query, expanded projects, results,
  keyboard controls and result actions. Keep the existing project-section
  fallback on layouts without shortcut actions.
- Advance relevant installer identity/source digest so existing installations
  migrate through their normal refresh lifecycle.

## Model diagnosis and activation

Static current renderer code uses native app-server `model/list` for this menu;
the configured custom catalog's visible models bypass its remote model whitelist.
The dedicated app-server started before GPT-6.1 Sol appeared in the continuously
updated custom catalog. Current disk catalog already contains visible 6.1.
Stale app-server/catalog state is therefore the leading explanation, not a
confirmed read of its present model-list response.

Do not fabricate a menu entry, overwrite catalogs, change account/configured
model selections, or invoke renderer/CDP events to refresh it. A full dedicated
host/app-server restart must preserve exact profile/process identity and receive
authorization for native-session/terminal interruption. Use process lifecycle
and backend-health recovery without the existing CDP console-click recovery;
native UI access remains denied. User confirmation or a supplied post-restart
screenshot is needed to establish actual model-picker acceptance.

## Verification

Fixtures cover native dot identity and handlers, same-parent order, hidden/rail
or different-parent rejection, incomplete top actions, stable repeated installs,
search placement after the entire module group, remount and query preservation.
Run `npm run check` and `npm test`, get a fresh read-only review, and commit only
owned differences. Existing dirty/untracked Butler and other feature work is
preserved. Record backend activation separately from native-window acceptance.

## Verified implementation and dedicated-host activation

- Fresh read-only review approved the owned layout changes.
- Targeted dot/search/injection tests passed 34/34. Full `npm test` passed
  1822/1822; `npm run check` passed 840 syntax files, 69 module-graph modules,
  and 882 structure files. Injection composition is 342 lines within its budget.
- Original dot node identity/state/handlers, incomplete installer choreography,
  search tail placement, query/expanded-state restoration, remounts and zero
  settled reorder writes are covered by the fixtures.
- Process inspection confirms the dedicated native host's exact profile and its
  earlier app-server startup. The native custom catalog currently includes a
  visible GPT-6.1 Sol. No native model-list RPC or UI inspection was performed.
- The user authorized a full restart of the dedicated native window and service.
  The service manager was stopped before terminating the exact dedicated-profile
  host, then restored from its existing LaunchAgent. An initial LaunchAgent
  registration error was resolved by retrying after removal completed.
- Recovery confirmed a new backend instance, dedicated native host and child
  app-server; the previous dedicated host/app-server exited. The original app
  instance remains alive. Backend health is OK with zero running terminals, and
  the backend model directory includes GPT-6.1 Sol with all six reasoning efforts.
  No profile, credential, catalog or model-selection configuration was changed.
- Activation used process lifecycle and backend-health checks without the default
  CDP console-click recovery. The user subsequently confirmed GPT-6.1 Sol appears
  in the native model menu. Their screenshot confirms project search follows the
  shortcut group, but the native dot remains below it. Dot placement requires the
  nested-wrapper repair in `2026-09-30-dot-placement-runtime-repair.md`.
