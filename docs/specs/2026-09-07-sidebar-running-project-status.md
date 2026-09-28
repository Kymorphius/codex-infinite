# Sidebar running project status

> 2026-09-28: the rail move is reverted. The native status rail stays at its trailing
> edge (native behavior, hidden on hover for row actions); the leading slot is used by
> the companion Claude disclosure (see 2026-09-28-claude-companion-sidebar.md). The
> project-level mirror below is unchanged.

Move the complete native conversation-status rail from the trailing edge to the
reserved slot before the conversation title. This includes running and any other
status rendered by the native client; selection/active-tab state must never be
treated as running. Mirror the real native status icon before the owning project
label so a collapsed project still exposes status, prioritizing running when a
project has multiple status-bearing conversations.

The integration detects the native non-interactive status rail by its layout and
hover contract, then repositions that exact React-owned rail using CSS without
reparenting, cloning, hiding or replacing it. The project marker derives a masked
visual from the real native SVG. Unknown DOM layouts fail closed: no status is
fabricated when a native rail or safe project association is unavailable.

Verify active-thread detection, local project-list identity reconciliation,
generated left indicators, original-spinner suppression, script compilation and
both injector paths. Run the repository checks and tests before deployment, then
verify rendered geometry on macOS and Windows.
