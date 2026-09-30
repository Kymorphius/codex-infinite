# Native dot placement after the latest sidebar wrapper change

## Problem and observed evidence

The user confirmed GPT-6.1 Sol appeared after the dedicated native host restart,
but the new screenshot still places the native Alfred dot after project search.
The previous helper only accepts a dot whose immediate parent is the immediate
parent of the New chat button. That relationship is absent in the latest native
sidebar.

Static inspection of the installed `app-initial-74096abaa6b3.js` shows:

- `N0o` renders the New chat `CV` control inside `a0o`.
- `a0o` renders a `div` containing the control and project transfer behavior.
- `G0o` renders `[j0o, I0o]` inside `PHr` / `wV`, the native navigation list.
- `I0o` renders the original dot through `k0o` and `CV`, with the stable
  `data-sidebar-destination="builtin:orbit"` identifier.

As a result, the New chat wrapper and dot are siblings in the native list while
the enhanced shortcuts were inserted inside the New chat wrapper. The previous
flat-parent fixtures could not reproduce this native nesting.

## Required behavior

The shortcut sequence is New chat, native dot, Butler, open local project,
checklist, board, console, sessions, priority, project search. Project search
remains immediately above the project list.

Resolve dot by its native destination identifier, never the mutable Alfred
nickname. Preserve its original node, parent, handlers, children, unread state,
paused state, focus behavior and React ownership. Preserve the New chat native
wrapper and its project transfer behavior.

## Placement design

Normalize the placement target to the native action list when its children
contain both the New chat wrapper and the native dot. Enhanced rows belong after
the original native dot in this list. Only the added rows may change parent;
native controls and wrappers retain their original parent relationships.

The dot helper returns the original native dot as the module placement anchor.
Module buttons still borrow classes from New chat, so the dot's dynamic selected
appearance cannot leak into unrelated actions.
It promotes known enhanced rows in canonical order, including open local
project. Existing Butler and checklist placement follows the open-project
parent, while project search follows the module group. This keeps the repair
bounded without changing those existing installers or adding another observer.
Defer a Butler-only initial state until the open-project entry arrives, so the
Butler fallback cannot repeatedly pull its entry back inside the New chat wrapper.

Older flat layouts keep the existing native dot positioning behavior. Ignore
hidden, inert, disconnected and rail-only candidates. A repeated placement pass
on a settled layout performs no DOM writes, including when native controls
remount or the installers run in a different initial order.

Do not use `display: contents` or CSS order to simulate the sequence: the native
New chat wrapper is also the project transfer target, and visual order must
agree with keyboard order.

## Verification

- Reproduce the installed native New chat wrapper plus sibling dot structure.
- Verify the original dot and New chat wrapper keep their parents and identity.
- Verify the complete installed shortcut order, independent installer startup
  order and zero DOM mutations after settling.
- Retain hidden/rail rejection and remount coverage.
- Run focused tests, repository syntax/structure checks and the full test suite.
- Native UI acceptance requires the affected window; tests alone do not establish
  visual acceptance. Native UI automation remains unavailable in this session.

## Delivery state

Spec created before implementation. The native model menu is user-confirmed.
The wrapped-parent repair passes 16 focused dot and module-entry tests, including
native identity/handler preservation and zero movement after repeated settled
placement passes. Repository syntax/module/structure checks pass and all 1,866
tests pass. A clean HEAD export with only the staged owned changes also passes
its full check and 137 focused tests, including the sidebar and installer paths.
Activation and affected-window visual acceptance remain in progress.
