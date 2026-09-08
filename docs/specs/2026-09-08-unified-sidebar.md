# Unified sidebar

## Behavior

Add a persistent, keyboard accessible `统一` toggle beside New chat, fixed outside the scrolling section list. Default off. On: remote projects appear directly alongside local projects in the existing Projects section, without a Remote heading or device tree. Device badges retain provenance, including offline state; identical names never merge identities. Off: restore the existing remote tree and its expansion state.

Remote project context menus can assign a project to an unambiguous existing custom section or return it to Projects. These are console-local presentation assignments, keyed by device and project identity; they never change execution ownership or write native sidebar state. Missing or ambiguous destinations fall back to Projects. Automatic sections and chat/work sections are not valid destinations. Native local project operations remain native.

## Integration boundaries

Use an independent sidebar presentation controller; append only console-owned lists after each native section inside its wrapper. Never move, clone as interactive replacements, hide, or delete native rows. Follow each native section's collapse state. The controller owns its toggle, lists, storage, and listeners, and cleans up on reinjection. Remote row rendering and owner-routed open/copy actions stay in the remote sidebar adapter.

Persist mode and bounded assignments in localStorage with failure-safe defaults. No storage credentials, transport, federation contracts, or native project ownership changes. Remote snapshots retain existing limits, and the UI must disclose unloaded counts.

## Verification

Regression coverage: persistent toggle and reinjection; no remote heading/device tree in unified mode; collapsed and missing sections; assignment identity separation; native node preservation; offline disabled opening; repeated snapshot placement without duplicates. Run npm run check and npm test. Exercise live macOS toggle, native collapse and project menu; Windows requires separate platform verification.

## Acceptance evidence

2026-09-08 macOS dedicated shell: real pointer clicks verified on/off, native
Projects collapse/expand, and remote project context-menu move to 等待 and back
to Projects. 55 remote projects appeared in the unified list; retained native
project node identities survived mode switching. Offline MacBook Pro projects
remained visible and Windows projects retained device labels. Background service
was reloaded; Windows native UI deployment/validation is outside this change.

Assignments persist on this console only. Custom destinations are currently
identified by unique visible native heading; rename/deletion/ambiguity returns
the affected project to Projects until reassigned. No cross-device section sync
or native drag registration is introduced.

Final checks: `npm run check` passed; `npm test` passed all 503 tests.
