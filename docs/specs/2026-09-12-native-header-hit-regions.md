# Native conversation header hit regions

Status: implemented; native mouse confirmation pending

## Problem

The sidebar mode, Turbo, settings, search and activity controls respond while
Console is visible but stop receiving native mouse input on conversation pages.
The tab inset moves the full-width native fixed header down by 36 pixels. Its
Electron drag region then covers the sidebar controls at y=46..78, even though
DOM hit testing reports those buttons because the header has pointer-events:none.
Console hides this native header, explaining the route-specific behavior.

## Change

Retain the native global header position and side slots. Reserve the existing
36-pixel content inset, but translate only the header's direct conversation
content child, identified by app-shell-header-context-menu-surface. Keep native
sidebar/back/forward controls at their original position without compensating
translations. Ordinary in-content headers may retain the inset positioning.
Preserve the native platform-specific fixed-header top offset and drag rules.

The injection and tab-controller versions both advance so a running desktop
reinstalls the corrected geometry while preserving open tab state.

## Verification

- Test native fixed and ordinary in-content headers independently.
- Compare Console and a mounted native conversation after hot injection.
- Confirm the global drag header no longer overlaps the sidebar control row.
- Confirm conversation toolbar remains below the tabs and native side controls
  remain in the original top row.
- DOM hover and synthetic input are diagnostic evidence only; native mouse
  acceptance requires an operating-system input check or user confirmation.
- Run npm run check, npm test and git diff --check before the scoped checkpoint.

## Recorded evidence (2026-09-12)

The running conversation page now reports global header bounds
`[0,0,1280,46]`, left slot `[0,0,326.49,46]`, and center content
`[326.49,36,917.51,46]`. The Turbo control is at `[150.22,50,80.27,24]`;
the global header no longer intersects it. The old inverse button translation
rule is absent after upgrading both injection versions.

Isolated Chromium layout fixtures with native header offsets of 0px and 10px
retain both native offsets and left slots, move the center by exactly 36px,
and keep ordinary in-content headers at 36px. Full working-tree tests pass
603/603; an isolated snapshot of the exact staged changes passes its 569/569
tests. Both snapshots pass syntax and structure checks, and staged diff checks
pass. OS-level mouse behavior awaits user confirmation.
