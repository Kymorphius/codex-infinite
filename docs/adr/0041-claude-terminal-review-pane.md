# 0041: Claude terminal review pane

- Status: accepted
- Date: 2026-09-28

The native Claude terminal is an interactive PTY and must remain the sole owner of
its input. A second pane should not fork or duplicate the Claude process. Keep
one session controller on the left and add a separate read-only Git projection on
the right, keyed by the managed conversation ID. The native binding resolves that
ID before running bounded Git reads. No shell, file write or external diff driver
is part of this projection. This preserves the native transport boundary in ADR
0029 and the existing project/session ownership.
