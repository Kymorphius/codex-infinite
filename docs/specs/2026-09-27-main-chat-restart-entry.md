# Main chat restart entry

## Problem

The native chat shortcut for restarting the control console is positioned next to
the upstream Help button. The newer ChatGPT interface no longer exposes the
expected Help button, so the shortcut is hidden even though restart remains
available inside the separate dashboard window.

## Behavior

- Keep the existing version and `原生` controls at the right end of the
  control console's own top conversation-tab bar in the dedicated chat window.
- Add `重启加强版` as an item in the upstream Help menu while it is open. Do not
  add another permanent restart button to the chat toolbar.
- Keep the restart confirmation and its current device-scoped action unchanged.
- Reattach the controls if the native tab bar is replaced during reinjection.
- Do not inject this shortcut into the ordinary, unwrapped ChatGPT process.

## Design and safety

`src/native-sidebar-restart.mjs` attaches the version and native-app shortcut
to the console-owned tab bar. It recognizes the upstream Help trigger by its
accessible label and adds one item only to its open menu. It does not depend on
the Help trigger's old geometry to expose the action. The confirmation remains
an exact-origin local iframe; restart still requires an explicit click in that
confirmation.

## Verification

- Unit test: the restart item appears only in the open Help menu and survives
  replacement of that menu; version/native controls survive tab-bar replacement.
- Unit test: restart confirmation still uses the local origin and rejects
  unrelated cancellation messages.
- Run `npm run check` and `npm test`.
- Inspect the dedicated chat window when desktop access permits it; static
  and process checks alone do not count as visual acceptance.
