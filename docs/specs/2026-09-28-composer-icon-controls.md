# Composer icon controls

- Status: implemented
- Date: 2026-09-28

## Problem

The console adds text pills to the native composer footer (存待办, 领任务 N, 待办 N,
百万, 路由, Claude 预览), about 360px next to native icon buttons. Narrow windows wrap
the footer.

## Behavior

- One presentation layer turns those controls into 28px round icon buttons like the
  native ones. It does not change any control's module, click handling, state
  attributes or order (the control-order module keeps working).
- Registry (selector → icon): save `[data-ccc-save-draft-todo]` tray-down; queue
  `[data-ccc-held-queue-button]` list; claim `[data-ccc-claim-task]` clipboard-check;
  context `[data-codex-control-console-context-toggle]` expand corners; routing
  `[data-codex-control-console-native-jev-current]` split arrows; Claude preview
  `[data-ccc-claude-preview]` sparkle.
- The turn-state readout (`780`) stays a number: it is a measurement, not an action.
- A trailing count in the label (领任务 32, 待办 1) becomes a small badge; no count, no
  badge. The full visible label becomes the tooltip; it also becomes the accessible
  name unless the control already has its own `aria-label`, which is kept and used as
  the tooltip.
- Labels change as the owning modules re-render (counts, 判断中…); a mutation observer
  re-derives badge and tooltip. Only attributes are written, never text or children.
- Every iconized control is forced to `inline-flex`, 28px flex basis: owners use
  different displays (the Claude preview button is `block`) and inline flex bases
  (路由 sets `flex: 0 0 48px`), which otherwise shift or widen the icon.
- Icons are CSS masks filled with `currentColor`, so existing enabled/warning colors
  and backgrounds still apply. Children and text are hidden only visually.

## Non-goals

- Native ChatGPT buttons, the terminal composer and the order/drag behavior are
  unchanged.
