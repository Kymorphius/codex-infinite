# Session device role labels and order

Status: implemented and verified on 2026-08-31.

## Problem

Session Center combines conversations from remote Codex nodes and the current
local node. Device cards need an explicit role label, and the local card should
not obscure remote activity at the top of the list. Pure configured order does
not guarantee that presentation.

## Design

- Every device card displays a role pill: `远端` for remote nodes and `本机`
  for the current local node.
- Remote pills use a blue treatment and local pills use a purple treatment in
  both light and dark themes so the roles remain visually distinct.
- Sort remote nodes before the local node.
- Preserve configured order within the remote tier and within the local tier so
  activity refreshes cannot make device cards flap.
- Keep project cards inside each device ordered by weighted project priority.
- Treat only the normalized `local-codex` kind as local; unknown provider kinds
  remain in the non-local tier rather than being allowed to displace the local
  card from the final position.

## Acceptance criteria

- [x] Remote device cards precede the local device card.
- [x] The local device card remains last as activity timestamps change.
- [x] Device cards expose explicit `远端` and `本机` labels.
- [x] Remote and local labels use distinct, theme-aware colors.
- [x] Same-role devices retain their configured relative order.
- [x] Project weighting and session recency order are unchanged.
- [x] Focused and full regression checks pass.
